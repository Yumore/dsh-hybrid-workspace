import AppKit
import WebKit

final class ShellDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let raw = CommandLine.arguments.first(where: { $0.hasPrefix("http://") || $0.hasPrefix("https://") }),
              let url = URL(string: raw),
              let host = url.host?.lowercased(),
              host == "127.0.0.1" || host == "localhost" || host == "::1" || host == "[::1]",
              url.path.hasSuffix("/hybrid-workspace/shell") || url.path.hasSuffix("/hybrid-workspace/shell/") else {
            NSApp.terminate(nil)
            return
        }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self

        // 按当前屏幕可见区域收口，避免 1280x900 的固定窗口在小屏或分屏上落到屏幕外。
        let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 900)
        let width = min(1280, max(640, visible.width - 80))
        let height = min(900, max(480, visible.height - 80))
        let frame = NSRect(
            x: visible.midX - width / 2,
            y: visible.midY - height / 2,
            width: width,
            height: height
        )
        let win = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        win.title = "工作区控制台"
        // 独立壳可能从全屏 Space 里被启动；显式移动到当前 Space，避免窗口被留在后台桌面。
        win.collectionBehavior.insert(.moveToActiveSpace)
        win.contentView = web
        win.makeKeyAndOrderFront(nil)
        web.load(URLRequest(url: url))
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
        self.window = win
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

let app = NSApplication.shared
let delegate = ShellDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
