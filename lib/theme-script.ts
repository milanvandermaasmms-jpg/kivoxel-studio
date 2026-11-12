// Runs before first paint so there is no white flash. Dark is the default theme of this app.
// Separate file without "use client" so the server layout can import it.
export const THEME_KEY = "kivoxel-studio.theme";

export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;
