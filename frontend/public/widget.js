/* ERIL website chat. Embed: <script src="https://YOUR-APP/widget.js" data-key="WIDGET_KEY" async></script> */
(function () {
  var s = document.currentScript;
  if (!s || window.__erilChat) return;
  var key = s.getAttribute('data-key');
  if (!key) return;
  window.__erilChat = true;
  var origin = new URL(s.src, location.href).origin;
  var f = document.createElement('iframe');
  f.src = origin + '/w/chat/' + encodeURIComponent(key) + '?page=' + encodeURIComponent(location.href.slice(0, 480));
  f.title = 'Chat';
  f.setAttribute('allowtransparency', 'true');
  var base = 'position:fixed;bottom:12px;right:12px;width:84px;height:84px;border:0;z-index:2147483000;background:transparent;color-scheme:light;';
  f.style.cssText = base;
  var side = 'right';
  var state = 'closed';
  function layout() {
    var small = window.innerWidth < 480;
    f.style.display = state === 'hidden' ? 'none' : 'block';
    f.style.left = side === 'left' ? (state === 'open' && small ? '0' : '12px') : 'auto';
    f.style.right = side === 'right' ? (state === 'open' && small ? '0' : '12px') : 'auto';
    if (state === 'open') {
      f.style.width = small ? '100%' : Math.min(400, window.innerWidth - 24) + 'px';
      f.style.height = small ? '100%' : Math.min(640, window.innerHeight - 24) + 'px';
      f.style.bottom = small ? '0' : '12px';
    } else {
      f.style.width = '84px';
      f.style.height = '84px';
      f.style.bottom = '12px';
    }
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== f.contentWindow) return;
    var d = e.data || {};
    if (d.type !== 'eril-chat') return;
    if (d.side === 'left' || d.side === 'right') side = d.side;
    if (d.state === 'open' || d.state === 'closed' || d.state === 'hidden') state = d.state;
    layout();
  });
  window.addEventListener('resize', layout);
  (document.body || document.documentElement).appendChild(f);
})();
