
document.addEventListener("DOMContentLoaded", () => {
  const devtoolsModal = document.getElementById("inspectWarningModal");

  const showDevtoolsWarning = () => {
    if (devtoolsModal) devtoolsModal.classList.remove("hidden");
  };

 
  document.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    const isF12 = e.key === "F12";
    const isInspectCombo = e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(key);
    const isViewSource = e.ctrlKey && key === "u";

    if (isF12 || isInspectCombo || isViewSource) {
      e.preventDefault();
      showDevtoolsWarning();
    }
  });

  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  console.log("%cStop!", "color:#f43f5e;font-size:32px;font-weight:bold;");
  console.log(
    "%cThis is a browser feature intended for developers. Pasting code here can compromise your anonymity. If someone asked you to paste something here, it is a scam.",
    "color:#94a3b8;font-size:12px;"
  );
});
