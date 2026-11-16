window.__ModuleLoader__.load({
  id: 'dsh-web-chat',
  factory(require) {
    const { createElement } = require('react')
    const name = 'dsh-web-chat'
    const title = () => 'DeepSeek 对话'

    function Panel() {
      return createElement('iframe', {
        title: title(),
        src: new URL('api/dsh-web-chat-panel?asset=index.html', document.baseURI).href,
        allow: 'microphone',
        sandbox: 'allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox',
        style: { display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent' },
      })
    }

    function apply(ctx) {
      const grabMicrophone = frame => {
        const panel = [...document.querySelectorAll('iframe[title="DeepSeek 对话"]')]
          .find(element => element.contentWindow === frame)
        if (!panel || !panel.getClientRects().length || !navigator.userActivation.isActive)
          throw new DOMException('请在 DeepSeek 对话面板内点击录音', 'NotAllowedError')
        return navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        })
      }
      ctx.effect(() => {
        Object.defineProperty(window, '__DSWC_MICROPHONE__', { configurable: true, value: grabMicrophone })
        return () => Reflect.deleteProperty(window, '__DSWC_MICROPHONE__')
      }, name + ': 麦克风')
      ctx.effect(() => {
        const navigate = (frame, sessionId) => {
          const panel = [...document.querySelectorAll('iframe[title="DeepSeek 对话"]')]
            .find(element => element.contentWindow === frame)
          if (!panel || !navigator.userActivation.isActive || !/^[\w-]{1,128}$/.test(sessionId)) return false
          ctx.uiWorkspace.openSession(sessionId)
          return true
        }
        Object.defineProperty(window, '__DSWC_OPEN_AGENT__', { configurable: true, value: navigate })
        return () => Reflect.deleteProperty(window, '__DSWC_OPEN_AGENT__')
      }, name + ': 原生会话导航')
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: name, kind: name, title, keepMounted: false,
        guide: [{ id: 'open', order: 35, title }],
      }), name + ': 侧栏标签')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: name,
      }, Panel)), name + ': 侧栏内容')
    }

    return { name, inject: ['slots', 'sidebarRightTabs', 'uiWorkspace'], apply }
  },
})
