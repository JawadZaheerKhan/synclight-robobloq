// Screen-capture helper: streams tiny downscaled frames of every display to stdout.
// stdout frame : [displayIndex u8][width u16 BE][height u16 BE][width*height*3 RGB bytes]
// stderr line  : JSON list of displays (index, id, name, pixel size), printed once at start.
import Foundation
import ScreenCaptureKit
import CoreMedia
import CoreVideo
import AppKit

let outLock = NSLock()
let GRID_W = 96

final class Receiver: NSObject, SCStreamOutput {
    let index: UInt8
    init(index: UInt8) { self.index = index }
    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sb.isValid, let pb = CMSampleBufferGetImageBuffer(sb) else { return }
        if let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let st = arr.first?[.status] as? Int, st != SCFrameStatus.complete.rawValue { return }
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), bpr = CVPixelBufferGetBytesPerRow(pb)
        var d = Data(capacity: 5 + w * h * 3)
        d.append(index); d.append(UInt8(w >> 8)); d.append(UInt8(w & 255)); d.append(UInt8(h >> 8)); d.append(UInt8(h & 255))
        let p = base.assumingMemoryBound(to: UInt8.self)
        for y in 0..<h {
            let row = p + y * bpr
            for x in 0..<w { d.append(row[x * 4 + 2]); d.append(row[x * 4 + 1]); d.append(row[x * 4]) } // BGRA -> RGB
        }
        outLock.lock(); FileHandle.standardOutput.write(d); outLock.unlock()
    }
}

func screenName(_ id: CGDirectDisplayID) -> String {
    for s in NSScreen.screens {
        if let n = s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID, n == id { return s.localizedName }
    }
    return "Display \(id)"
}

func fail(_ msg: String) -> Never { FileHandle.standardError.write(Data((msg + "\n").utf8)); exit(1) }

let fps = Int(CommandLine.arguments.dropFirst().first ?? "") ?? 30
var keep: [SCStream] = []
var receivers: [Receiver] = []

Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        var info: [[String: Any]] = []
        for (i, disp) in content.displays.enumerated() {
            let gh = max(8, Int((Double(GRID_W) * Double(disp.height) / Double(disp.width)).rounded()))
            let cfg = SCStreamConfiguration()
            cfg.width = GRID_W; cfg.height = gh
            cfg.pixelFormat = kCVPixelFormatType_32BGRA
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
            cfg.queueDepth = 3
            cfg.showsCursor = false
            let stream = SCStream(filter: SCContentFilter(display: disp, excludingWindows: []), configuration: cfg, delegate: nil)
            let r = Receiver(index: UInt8(i))
            try stream.addStreamOutput(r, type: .screen, sampleHandlerQueue: DispatchQueue(label: "cap\(i)"))
            try await stream.startCapture()
            keep.append(stream); receivers.append(r)
            info.append(["index": i, "id": Int(disp.displayID), "name": screenName(disp.displayID), "width": disp.width, "height": disp.height])
        }
        let json = try JSONSerialization.data(withJSONObject: info)
        FileHandle.standardError.write(json + Data("\n".utf8))
    } catch {
        fail("capture failed: \(error)")
    }
}
RunLoop.main.run()
