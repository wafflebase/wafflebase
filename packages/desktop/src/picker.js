// Server picker. Validation and persistence live in Rust (`set_server`), so
// this page only collects the address and shows what the shell says.
const { invoke } = window.__TAURI__.core;

const form = document.getElementById("picker");
const input = document.getElementById("server");
const error = document.getElementById("error");
const connect = document.getElementById("connect");
const back = document.getElementById("back");

let current = null;

invoke("get_server")
  .then((info) => {
    current = info.origin;
    if (current) {
      input.value = current;
      back.hidden = false;
    }
  })
  .catch(() => {});

back.addEventListener("click", () => {
  if (current) window.location.replace(current);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  connect.disabled = true;
  try {
    // On success the shell navigates this window to the server.
    await invoke("set_server", { input: input.value });
  } catch (message) {
    error.textContent = String(message);
    connect.disabled = false;
    input.focus();
  }
});
