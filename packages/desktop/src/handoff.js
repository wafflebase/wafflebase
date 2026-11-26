// Redeem the one-time code: POST { code, verifier } to
// <backend>/auth/desktop/session. The backend sets the session cookies and
// answers 303 to the frontend.
const { invoke } = window.__TAURI__.core;

const form = document.getElementById("handoff");

function fail(text) {
  document.getElementById("title").textContent = "Sign-in did not finish";
  document.getElementById("message").textContent = text;
  document.getElementById("actions").hidden = false;
}

document.getElementById("back").addEventListener("click", () => {
  invoke("cancel_login").catch(() => {});
});

invoke("take_handoff")
  .then((handoff) => {
    if (!handoff) {
      // Reloaded, or opened directly: the material is handed out once.
      fail("This sign-in was already used. Sign in again from Wafflebase.");
      return;
    }
    form.action = new URL("/auth/desktop/session", handoff.backend).toString();
    form.elements.code.value = handoff.code;
    form.elements.verifier.value = handoff.verifier;
    form.elements.returnTo.value = handoff.returnTo ?? "";
    form.submit();
    // A redirect off the chosen server is caught by the shell, which moves
    // this window to the sign-in page with the reason. This is only for a
    // server that never answers; WebKit's own request timeout is longer.
    // Until then the POST may still succeed, so the page stays as it is.
    setTimeout(() => {
      fail(
        "The server is taking a long time to answer. Wait a little longer, " +
          "or go back and sign in again.",
      );
    }, 60000);
  })
  .catch((error) => fail(String(error)));
