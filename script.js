const menu = document.querySelector(".mobile-menu");
const nav = document.querySelector(".main-nav");

if (menu && nav) {
  menu.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
  });

  nav.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      menu.setAttribute("aria-expanded", "false");
    });
  });
}

const password = document.getElementById("password");
const showPassword = document.getElementById("show-password");

if (password && showPassword) {
  showPassword.addEventListener("click", () => {
    const showing = password.type === "text";
    password.type = showing ? "password" : "text";
    showPassword.textContent = showing ? "Show" : "Hide";
  });
}



document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener("click", () => {
    const id = link.getAttribute("href");
    if (id === "#") return;
  });
});
