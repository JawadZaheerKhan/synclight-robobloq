// Generates the 1024px app icon: a colour-wheel disc on a dark squircle.
import Cocoa

func hsv(_ h: Double, _ s: Double, _ v: Double) -> (Double, Double, Double) {
    let i = Int(h * 6) % 6, f = h * 6 - floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
    return [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i]
}

func disc(_ d: Int) -> CGImage {
    var px = [UInt8](repeating: 0, count: d * d * 4)
    let c = Double(d) / 2
    for y in 0..<d { for x in 0..<d {
        let dx = Double(x) + 0.5 - c, dy = Double(y) + 0.5 - c, r = hypot(dx, dy) / c
        if r > 1 { continue }
        let h = (atan2(dy, dx) / (2 * Double.pi) + 1).truncatingRemainder(dividingBy: 1)
        let (R, G, B) = hsv(h, min(1, r * 1.04), 1)
        let a = r > 0.994 ? (1 - r) / 0.006 : 1
        let i = (y * d + x) * 4
        px[i] = UInt8(R * a * 255); px[i + 1] = UInt8(G * a * 255); px[i + 2] = UInt8(B * a * 255); px[i + 3] = UInt8(a * 255)
    } }
    let prov = CGDataProvider(data: Data(px) as CFData)!
    return CGImage(width: d, height: d, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: d * 4, space: CGColorSpaceCreateDeviceRGB(),
                   bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: prov, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
}

let S = 1024
let ctx = CGContext(data: nil, width: S, height: S, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let path = CGPath(roundedRect: body, cornerWidth: 186, cornerHeight: 186, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 36, color: CGColor(gray: 0, alpha: 0.5))
ctx.addPath(path); ctx.setFillColor(CGColor(gray: 0.1, alpha: 1)); ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(path); ctx.clip()
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                      colors: [CGColor(red: 0.20, green: 0.20, blue: 0.24, alpha: 1), CGColor(red: 0.06, green: 0.06, blue: 0.08, alpha: 1)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
// soft glow behind the wheel
let glow = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                      colors: [CGColor(red: 0.4, green: 0.5, blue: 1, alpha: 0.35), CGColor(red: 0.4, green: 0.5, blue: 1, alpha: 0)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 512), startRadius: 120, endCenter: CGPoint(x: 512, y: 512), endRadius: 470, options: [])
ctx.draw(disc(1200), in: CGRect(x: 512 - 290, y: 512 - 290, width: 580, height: 580))
// knob
ctx.setStrokeColor(CGColor(gray: 1, alpha: 1)); ctx.setLineWidth(16)
ctx.setShadow(offset: .zero, blur: 14, color: CGColor(gray: 0, alpha: 0.5))
let kx = 512 + 130.0, ky = 512 + 150.0
ctx.strokeEllipse(in: CGRect(x: kx - 40, y: ky - 40, width: 80, height: 80))
ctx.restoreGState()

let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
