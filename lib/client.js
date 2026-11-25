// 浏览器半边：在会话顶部工具栏放一个“工作区”按钮，点开插件面板。
// 只依赖宿主内置的 react 和 slots 服务，不引入额外包。

window.__ModuleLoader__.load({
  id: "dsh-hybrid-workspace-v2",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    var buttonStyle = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      alignSelf: "center",
      boxSizing: "border-box",
      height: "24px",
      minHeight: "24px",
      maxHeight: "24px",
      width: "auto",
      minWidth: "0",
      padding: "0 8px",
      border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)",
      borderRadius: "6px",
      background: "var(--dsw-alias-bg-layer-1, transparent)",
      color: "var(--dsw-alias-label-secondary, #666)",
      font: "inherit",
      fontSize: "11px",
      lineHeight: "1",
      cursor: "pointer",
      whiteSpace: "nowrap"
    };

    function OpenPanelButton() {
      return React.createElement("button", {
        type: "button",
        title: "打开混合工作区面板",
        "aria-label": "打开混合工作区面板",
        style: buttonStyle,
        onClick: function () {
          var href = new URL("hybrid-workspace/", window.location.origin).href;
          // DSH 桌面端把 window.open 交给系统浏览器；系统浏览器没有 DSH 登录态，
          // 只会看到 authentication required。这里直接在 DSH 当前窗口打开，
          // 面板右上角「关闭面板」会回到 DSH 首页。
          window.location.assign(href);
        }
      }, "工作区");
    }

    function apply(ctx) {
      ctx.slots.inject("conversation.session.header.utilities", function () {
        return ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "hybrid-workspace-open",
          order: 90
        }, OpenPanelButton);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
