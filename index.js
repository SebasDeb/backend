import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Guardamos sesiones en memoria
// sessions = { "179763": { cookies: [...], username: "179763", password: "xxx" } }
let sessions = {};

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('API funcionando desde Render ');
  console.log('API funcionando desde Render');
});


/**
 * LOGIN a intranet.udlap.mx
 */
app.post("/api/login", async (req, res) => {
  console.log("Login request body:", req.body);

  const { username, password } = req.body;

  const browser = await puppeteer.launch({ 
     headless: true,
    args: [
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--no-sandbox",
    ],
    
   });

   console.log("Browser launched");
  const page = await browser.newPage();

  console.log("Trying to log in user:", username);
  try {
    await page.goto("https://online.udlap.mx/intranet/Login/Index", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    console.log("Page loaded, filling form");
    await page.type("#username", username, { delay: 50 });
    await page.type("#password", password, { delay: 50 });


    console.log("Submitting form");
    await Promise.all([
      page.click("#btnAceptar"),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
    ]);

    console.log("Navegación completada, URL actual:", page.url());


    const cookies = await page.cookies();
    sessions[username] = { cookies, username, password };

    res.json({ success: true, message: "Login exitoso", user: username });
    console.log("User logged in:", username);

  } catch (err) {
    console.error("Error login:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await browser.close();
  }
});

/**
 * CONSULTAR HORARIO (Materia + Días + Hora)
 */
app.get("/api/horario/:user", async (req, res) => {
  const user = req.params.user;
  const session = sessions[user];

  if (!session) {
    return res.status(401).json({
      success: false,
      error: "Usuario no logueado, haz login primero",
    });
  }

  let browser;
  try {
    console.log("🧭 Abriendo navegador para horario...");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
      ],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    // Log de peticiones fallidas (útil para ver bloqueos/CORS/SSL)
    page.on("requestfailed", (req) => {
      console.log("❌ Request failed:", req.url(), req.failure()?.errorText);
    });

    // 1) Reusar cookies pero ajustando dominio para subdominios
    //    (las ponemos en .udlap.mx para que apliquen en online.* e intranet.*)
    const normalizedCookies = session.cookies.map((c) => {
      const nc = { ...c };
      // sólo si venían ‘hostOnly’ para online.udlap.mx
      // forzamos dominio base:
      nc.domain = ".udlap.mx";
      // Puppeteer no acepta hostOnly en setCookie:
      delete nc.hostOnly;
      // Aseguramos secure para https
      nc.secure = true;
      return nc;
    });

    console.log("🍪 Seteando cookies normalizadas:", normalizedCookies.length);
    await page.setCookie(...normalizedCookies);

    // 2) Ir primero a la HOME donde ya quedaste logueado (mismo subdominio del login)
    console.log("🌍 Abriendo Home/Estudiantes en online...");
    await page.goto("https://online.udlap.mx/intranet/Home/Estudiantes", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    console.log("✅ URL actual:", page.url());

    // 3) Intentar el horario en *online* (evita salto de subdominio)
    //    Si NO existe en online, comenta este paso y usa el paso 4.
    const horarioUrlOnline = "https://online.udlap.mx/ConsultaHorarioAlumno/default.aspx";
    console.log("📄 Intentando horario en ONLINE:", horarioUrlOnline);
    try {
      await page.setExtraHTTPHeaders({
        Referer: "https://online.udlap.mx/intranet/Home/Estudiantes",
      });
      await page.goto(horarioUrlOnline, {
        waitUntil: "domcontentloaded", // menos exigente si hay recursos lentos
        timeout: 60000,
      });
      console.log("✅ URL horario (online):", page.url());
    } catch (e) {
      console.log("⚠️ Falló horario en ONLINE, probando INTRANET:", e.message);

    }

    // 5) Extraer materias + días + hora (ajusta selectores si cambian)
    const horario = await page.evaluate(() => {
      const materias = [];
      const rows = document.querySelectorAll("table tr");
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.classList.contains("orange")) {
          const materiaText = row.innerText.trim();
          const detalleRow = rows[i + 1];
          const detalleText = detalleRow ? detalleRow.innerText : "";

          // "Horario: L M X J V 08:00-09:00" (ajusta regex si el formato difiere)
          const regex = /Horario:\s*([^\d]+)\s+(\d{1,2}:\d{2}-\d{1,2}:\d{2})/;
          const match = detalleText.match(regex);
          if (match) {
            materias.push({
              materia: materiaText,
              dias: match[1].trim(),
              hora: match[2].trim(),
            });
          }
        }
      }
      return materias;
    });

    console.log("📚 Materias encontradas:", horario.length);
    res.json({ success: true, horario });
  } catch (err) {
    console.error("❌ Error al obtener horario:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) {
      await browser.close();
      console.log("🛑 Navegador cerrado (horario)");
    }
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
