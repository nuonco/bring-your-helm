declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

export function trackEvent(name: string, params?: Record<string, any>) {
  window.gtag?.("event", name, params);
}

export function trackPageView(path: string, title?: string) {
  window.gtag?.("event", "page_view", {
    page_path: path,
    page_title: title,
  });
}
