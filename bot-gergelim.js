const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys")
const QRCode = require("qrcode")
const cron = require("node-cron")
const fs = require("fs")
const express = require("express")

const app = express()
const PORT = process.env.PORT || 10000
let lastQR = null

app.get("/qr", async (req,res) => {
  if(!lastQR) return res.send("<h1 style='font-family:sans-serif'>Gerando QR... aguarde 20s e de F5<br><br>Se não aparecer, clica em Manual Deploy no Render e volta aqui</h1>")
  const qrImg = await QRCode.toDataURL(lastQR)
  res.send(`<div style="text-align:center;font-family:sans-serif"><h2>Escaneie com seu WhatsApp pessoal</h2><img src="${qrImg}" style="width:340px;border:10px solid #000"><p>WhatsApp > Aparelhos conectados > Conectar aparelho</p><p>QR expira em 30s, se expirar de F5</p></div>`)
})
app.get("/", (req,res) => res.send(`<h1>GERGELIM online ✅</h1><a href="/qr" style="font-size:22px">VER QR CODE AQUI</a>`))
app.listen(PORT, '0.0.0.0', () => console.log("Servidor online na porta " + PORT))

const NOME_GRUPO = "GERGELIM"
const ARQUIVO = "./agenda-gergelim.json"
if (!fs.existsSync(ARQUIVO)) {
  fs.writeFileSync(ARQUIVO, JSON.stringify([
    { data: "29/09/2026 16:15", titulo: "Análise presencial" },
    { data: "01/10/2026 11:45", titulo: "Osteopata" },
    { data: "07/10/2026 13:10", titulo: "Cinema Verity" },
    { data: "08/10/2026 12:00", titulo: "Riane avaliação diástase" }
  ], null, 2))
}
function calcularDias(dataStr) {
  try {
    const [d, m, resto] = dataStr.split("/"); const [y, hora] = resto.split(" "); const [hh, mm] = hora.split(":")
    const evento = new Date(parseInt(y), parseInt(m)-1, parseInt(d), parseInt(hh), parseInt(mm))
    const hoje = new Date(); hoje.setHours(0,0,0,0); evento.setHours(0,0,0,0)
    return Math.ceil((evento - hoje) / (1000*60*60*24))
  } catch(e){ return 99 }
}

async function iniciar() {
  const { version } = await fetchLatestBaileysVersion()
  console.log("Usando WA version", version)
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ 
    version,
    auth: state, 
    browser: ["GERGELIM", "Chrome", "122.0.0"],
    printQRInTerminal: false
  })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      lastQR = qr
      console.log("QR NOVO GERADO!")
    }
    if (connection === 'open') {
      console.log("✅ GERGELIM conectado 24h!")
      lastQR = null
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401
      console.log("Conexão fechada, reconectando...", shouldReconnect)
      if (shouldReconnect) iniciar()
    }
  })
  cron.schedule('0 8 * * *', async () => {
    try {
      const grupos = await sock.groupFetchAllParticipating()
      const grupo = Object.values(grupos).find(g => g.subject === NOME_GRUPO)
      if (!grupo) return
      const agenda = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"))
      for (let item of agenda) {
        const dias = calcularDias(item.data)
        if (dias <= 5 && dias >= 0) {
          let msg = `*GERGELIM - Agenda do Davi* 👶\n\n`
          if (dias > 1) msg += `⏳ Faltam ${dias} dias para: *${item.titulo}*\n📅 ${item.data}`
          else if (dias === 1) msg += `🚨 É AMANHÃ: *${item.titulo}*\n📅 ${item.data}`
          else msg += `🔔 *É HOJE!!!* *${item.titulo}* às ${item.data.split(" ")[1]}`
          await sock.sendMessage(grupo.id, { text: msg })
        }
      }
    } catch(e){ console.log("Erro cron:", e) }
  }, { timezone: "America/Sao_Paulo" })
}
iniciar()
