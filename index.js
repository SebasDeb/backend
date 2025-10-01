import express from "express";
import puppeteer from "puppeteer";

const app = express();
app.use(express.json());

// Guardamos sesiones en memoria
// sessions = { "179763": { cookies: [...], username: "179763", password: "xxx" } }
let sessions = {};

/**
 * LOGIN a intranet.udlap.mx
 */
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto("https://online.udlap.mx/intranet/Login/Index", {
      waitUntil: "networkidle2",
    });

    await page.type("#username", username, { delay: 50 });
    await page.type("#password", password, { delay: 50 });

    await Promise.all([
      page.click("#btnAceptar"),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

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
    return res
      .status(401)
      .json({ success: false, error: "Usuario no logueado, haz login primero" });
  }

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Reusar cookies
    await page.setCookie(...session.cookies);

    // Autenticación HTTP básica
    await page.authenticate({
      username: session.username,
      password: session.password,
    });

    await page.goto(
      "https://intranet.udlap.mx/ConsultaHorarioAlumno/default.aspx",
      { waitUntil: "networkidle2" }
    );

    // Extraer materias y horarios
    const horario = await page.evaluate(() => {
      const materias = [];
      const rows = document.querySelectorAll("table tr");

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Filas con la materia
        if (row.classList.contains("orange")) {
          const materiaText = row.innerText.trim();

          // El siguiente tr tiene el detalle (horario, idioma, etc.)
          const detalleRow = rows[i + 1];
          const detalleText = detalleRow ? detalleRow.innerText : "";

          // Buscar "Horario: ..."
          const regex = /Horario:\s*([^\d]+)\s+(\d{1,2}:\d{2}-\d{1,2}:\d{2})/;
          const match = detalleText.match(regex);

          if (match) {
            const dias = match[1].trim();
            const hora = match[2].trim();

            materias.push({
              materia: materiaText,
              dias,
              hora,
            });
          }
        }
      }

      return materias;
    });

    res.json({ success: true, horario });
  } catch (err) {
    console.error("Error al obtener horario:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await browser.close();
  }
});

app.listen(3000, "0.0.0.0", () => {
  console.log("✅ API corriendo en http://0.0.0.0:3000");
});

