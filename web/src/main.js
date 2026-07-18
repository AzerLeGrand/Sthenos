// Point d'entrée du front : importe les styles globaux et monte l'application Svelte.
import "./app.css";
import App from "./App.svelte";

const app = new App({ target: document.getElementById("app") });

export default app;
