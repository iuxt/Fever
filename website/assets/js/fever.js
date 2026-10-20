const toggle = document.querySelector('.navbar-burger');
const menu = document.querySelector('#fever-menu');
if (toggle && menu) {
  document.documentElement.classList.add('has-navigation-js');
  const close = () => {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '展开导航');
    toggle.classList.remove('is-active');
    menu.classList.remove('is-active');
  };
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? '收起导航' : '展开导航');
    toggle.classList.toggle('is-active', expanded);
    menu.classList.toggle('is-active', expanded);
  });
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', close));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      close();
      toggle.focus();
    }
  });
}
