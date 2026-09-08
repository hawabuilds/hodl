self.addEventListener("push", (event) => {
  let data = {title: "HODL", body: "", url: "/home"};
  try {
    data = {...data, ...(event.data ? event.data.json() : {})};
  } catch {
    data.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "HODL", {
      body: data.body || "",
      data: {url: data.url || "/home"},
      icon: "/icon",
      badge: "/icon",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/home";
  event.waitUntil(
    self.clients.matchAll({type: "window", includeUncontrolled: true}).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
