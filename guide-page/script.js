const navLinks = document.querySelectorAll('.nav-links a');
const sections = [...document.querySelectorAll('main section[id]')];

function cleanHostedUrl() {
  if (!location.hash) return;
  const target = document.querySelector(location.hash);
  const cleanPath = location.pathname.replace(/\/index\.html$/, '/');
  history.replaceState(null, '', cleanPath + location.search);
  if (target) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

cleanHostedUrl();

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const selector = link.getAttribute('href');
    if (!selector || selector === '#') return;
    const target = document.querySelector(selector);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    for (const link of navLinks) {
      link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`);
    }
  }, { rootMargin: '-25% 0px -65%', threshold: [0.1, 0.5] });

  sections.forEach((section) => observer.observe(section));
}
