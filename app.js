const VIEWS = ["guide", "settings", "capture", "results", "detail", "history"];

function showView(name) {
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).classList.toggle("active", view === name);
  }
}

function initDebugNav() {
  const nav = document.getElementById("debug-nav");
  nav.addEventListener("click", (event) => {
    const view = event.target.dataset.view;
    if (view) showView(view);
  });
}

initDebugNav();
showView("guide");
