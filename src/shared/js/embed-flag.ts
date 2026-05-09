(function initEmbedFlag() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("embed") === "1") {
    document.documentElement.classList.add("embedded");
  }
})();

export {};
