for (const link of document.querySelectorAll('nav a[href]')) {
  if (link.pathname === window.location.pathname && !link.hash) {
    link.setAttribute('aria-current', 'page');
  }
}
