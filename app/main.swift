// SyncLight 2.0 — a thin native window around the local controller.
// Starts the bundled controller if one isn't already running, and stops it again on quit.
import Cocoa
import WebKit

let url = URL(string: "http://127.0.0.1:7878")!

// The server (JavaScript) is bundled inside the app; set SYNCLIGHT_SERVER_DIR to run a checkout instead.
let serverDir: String = {
    if let d = ProcessInfo.processInfo.environment["SYNCLIGHT_SERVER_DIR"] { return d }
    return (Bundle.main.resourcePath ?? ".") + "/server"
}()

// Node.js is the one thing the app can't bundle. Look in the usual places, then ask the user's login shell
// (covers nvm, fnm, asdf, Homebrew on either architecture).
func findNode() -> String? {
    let fm = FileManager.default
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] where fm.isExecutableFile(atPath: p) { return p }
    let sh = Process(); sh.executableURL = URL(fileURLWithPath: "/bin/zsh"); sh.arguments = ["-lic", "command -v node"]
    let pipe = Pipe(); sh.standardOutput = pipe; sh.standardError = FileHandle.nullDevice
    do { try sh.run() } catch { return nil }
    sh.waitUntilExit()
    let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let path = out.split(separator: "\n").last.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
    return fm.isExecutableFile(atPath: path) ? path : nil
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var spawned: Process?

    func serverUp() -> Bool {
        var ok = false
        let sem = DispatchSemaphore(value: 0)
        var req = URLRequest(url: url.appendingPathComponent("api/lights")); req.timeoutInterval = 0.8
        URLSession.shared.dataTask(with: req) { _, resp, _ in ok = (resp as? HTTPURLResponse)?.statusCode == 200; sem.signal() }.resume()
        _ = sem.wait(timeout: .now() + 1.2)
        return ok
    }

    func startServer() -> Bool {
        guard let node = findNode() else {
            DispatchQueue.main.async {
                let a = NSAlert()
                a.messageText = "Node.js is required"
                a.informativeText = "SyncLight 2 needs Node.js 18 or newer to talk to your lights.\n\nInstall it from nodejs.org (or run \"brew install node\"), then open SyncLight 2 again."
                a.addButton(withTitle: "Quit")
                a.runModal(); NSApp.terminate(nil)
            }
            return false
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [serverDir + "/src/server.js"]
        p.currentDirectoryURL = URL(fileURLWithPath: serverDir)
        var env = ProcessInfo.processInfo.environment
        env["SYNCLIGHT_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)   // server exits if we do
        p.environment = env
        let log = (NSHomeDirectory() as NSString).appendingPathComponent("Library/Logs/SyncLight 2.log")
        FileManager.default.createFile(atPath: log, contents: nil)
        if let h = FileHandle(forWritingAtPath: log) { p.standardOutput = h; p.standardError = h }
        do { try p.run(); spawned = p; return true } catch { NSLog("could not start server: \(error)"); return false }
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        let cfg = WKWebViewConfiguration()
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 680, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "SyncLight 2.0"
        window.contentView = web
        window.setFrameAutosaveName("SyncLight2Main")
        window.minSize = NSSize(width: 420, height: 500)
        if !window.setFrameUsingName("SyncLight2Main") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        DispatchQueue.global().async {
            if !self.serverUp() {
                guard self.startServer() else { return }
                for _ in 0..<40 { if self.serverUp() { break }; Thread.sleep(forTimeInterval: 0.25) }
            }
            DispatchQueue.main.async { self.web.load(URLRequest(url: url)) }
        }
    }

    // If the page isn't reachable yet, retry shortly.
    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.web.load(URLRequest(url: url)) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool { window.makeKeyAndOrderFront(nil); return true }
    func applicationWillTerminate(_ n: Notification) { spawned?.terminate() }

    @objc func reloadPage() { web.reload() }

    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ sel: Selector?, _ key: String = "", mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: key); i.keyEquivalentModifierMask = mods; return i
        }
        let appMenu = NSMenu()
        appMenu.addItem(item("About SyncLight 2.0", #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Hide SyncLight 2.0", #selector(NSApplication.hide(_:)), "h"))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Quit SyncLight 2.0", #selector(NSApplication.terminate(_:)), "q"))
        let a = NSMenuItem(); a.submenu = appMenu; main.addItem(a)

        let edit = NSMenu(title: "Edit")
        edit.addItem(item("Undo", Selector(("undo:")), "z"))
        edit.addItem(item("Redo", Selector(("redo:")), "z", mods: [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(item("Cut", #selector(NSText.cut(_:)), "x"))
        edit.addItem(item("Copy", #selector(NSText.copy(_:)), "c"))
        edit.addItem(item("Paste", #selector(NSText.paste(_:)), "v"))
        edit.addItem(item("Select All", #selector(NSText.selectAll(_:)), "a"))
        let e = NSMenuItem(); e.submenu = edit; main.addItem(e)

        let view = NSMenu(title: "View")
        view.addItem(item("Reload", #selector(reloadPage), "r"))
        let v = NSMenuItem(); v.submenu = view; main.addItem(v)

        let win = NSMenu(title: "Window")
        win.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        win.addItem(item("Close", #selector(NSWindow.performClose(_:)), "w"))
        let w = NSMenuItem(); w.submenu = win; main.addItem(w)
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
}

// A plain `kill` (or logout) should quit cleanly so the server we started is stopped too.
signal(SIGTERM, SIG_IGN)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termSource.setEventHandler { NSApp.terminate(nil) }
termSource.resume()

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
