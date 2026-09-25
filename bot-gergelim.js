const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys")
const QRCode = require("qrcode")
const cron = require("node-cron")
const fs = require("fs")
const express = require("express")

const app = express()
const PORT = process.env.PORT || 10000
let lastQR = null

app.get("/qr", async (req,res) => {
  if(!lastQR) return res.send("<h1>Gerando QR... aguarde 20s e de F5</h1>")
  const qrImg = await QRCode.toDataURL(lastQR)
  res.send(`<div style="text-align:center;font-family:sans-serif"><h2>Escaneie</h2><img src="${qrImg}" style="width:340px;border:10px solid #000"><p>WhatsApp > Aparelhos conectados</p></div>`)
})
app.get("/", (req,res) => res.send(`<h1>GERGELIM online ✅</h1><a href="/qr">VER QR CODE</a> | <a href="/teste">TESTE AGORA</a>`))

app.get("/teste", async (req,res) => {
  try {
    if(!global.sockGlobal) return res.send("Bot ainda iniciando...")
    const grupos = await global.sockGlobal.groupFetchAllParticipating()
    const grupo = Object.values(grupos).find(g => g.subject === "GERGELIM")
    if (!grupo) return res.send("Grupo GERGELIM não encontrado")
    await enviarLembretes(grupo.id)
    res.send("✅ Teste enviado no GERGELIM!")
  } catch(e){ res.send("Erro: "+e.message) }
})

app.listen(PORT, '0.0.0.0', () => console.log("Servidor online na porta " + PORT))

const NOME_GRUPO = "GERGELIM"
const ARQUIVO = "./agenda-gergelim.json"
if (!fs.existsSync(ARQUIVO)) fs.writeFileSync(ARQUIVO, JSON.stringify([
  { data: "29/09/2026 16:15", titulo: "Análise presencial" },
  { data: "01/10/2026 11:45", titulo: "Osteopata" },
  { data: "07/10/2026 13:10", titulo: "Cinema Verity" },
  { data: "08/10/2026 12:00", titulo: "Riane avaliação diástase" }
], null, 2))

function getAgenda(){ try{ return JSON.parse(fs.readFileSync(ARQUIVO,"utf8")) } catch(e){ return [] } }
function salvarAgenda(a){ fs.writeFileSync(ARQUIVO, JSON.stringify(a,null,2)) }

function calcularDias(dataStr) {
  try {
    const [d, m, resto] = dataStr.split("/"); const [y, hora] = resto.split(" "); const [hh, mm] = hora.split(":")
    const evento = new Date(parseInt(y), parseInt(m)-1, parseInt(d), parseInt(hh), parseInt(mm))
    const hoje = new Date(); hoje.setHours(0,0,0,0); evento.setHours(0,0,0,0)
    return Math.ceil((evento - hoje) / (1000*60*60*24))
  } catch(e){ return 99 }
}

async function enviarLembretes(groupId){
  const agenda = getAgenda()
  for (let item of agenda) {
    const dias = calcularDias(item.data)
    if (dias <= 5 && dias >= 0) {
      let msg = `*GERGELIM - Agenda do Davi* 👶\n\n`
      if (dias > 1) msg += `⏳ Faltam ${dias} dias para: *${item.titulo}*\n📅 ${item.data}`
      else if (dias === 1) msg += `🚨 É AMANHÃ: *${item.titulo}*\n📅 ${item.data}`
      else msg += `🔔 *É HOJE!!!* *${item.titulo}* às ${item.data.split(" ")[1]}`
      await global.sockGlobal.sendMessage(groupId, { text: msg })
    }
  }
}

async function iniciar() {
  const { version } = await fetchLatestBaileysVersion()
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ version, auth: state, browser: ["GERGELIM", "Chrome", "122.0.0"] })
  global.sockGlobal = sock
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr) lastQR = qr
    if (connection === 'open') { console.log("✅ GERGELIM conectado 24h!"); lastQR = null }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== 401
      if (shouldReconnect) iniciar()
    }
  })

  // --- OUVE MENSAGENS NO GRUPO ---
  sock.ev.on('messages.upsert', async ({ messages }) => {
    try{
      const m = messages[0]
      if(!m.message || m.key.fromMe) return
      const idGrupo = m.key.remoteJid
      const grupos = await sock.groupFetchAllParticipating().catch(()=>null)
      if(!grupos) return
      const grupo = grupos[idGrupo]
      if(!grupo || grupo.subject!== NOME_GRUPO) return

      const texto = m.message.conversation || m.message.extendedTextMessage?.text || ""
      const txtLower = texto.toLowerCase()

      // COMANDO: gergelim agenda 15/10 09:00 Pediatra
      if(txtLower.startsWith("gergelim agenda") || txtLower.startsWith("agenda ")){
        // regex pega 15/10/2026 09:00 titulo ou 15/10 09:00 titulo
        const match = texto.match(/(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s+(\d{1,2}:\d{2})\s+(.+)/)
        if(!match){
          await sock.sendMessage(idGrupo, { text: `❌ Formato errado!\nUse assim:\n*gergelim agenda 15/10 09:00 Pediatra*\nOu: *gergelim agenda 15/10/2026 09:00 Pediatra*` })
          return
        }
        let dataParte = match[1]
        let horaParte = match[2]
        let titulo = match[3].trim()
        if(!dataParte.includes("/202")){ // se não tem ano, coloca 2026
          dataParte = dataParte + "/2026"
        }
        const dataCompleta = `${dataParte} ${horaParte}`
        const agenda = getAgenda()
        agenda.push({ data: dataCompleta, titulo })
        salvarAgenda(agenda)
        await sock.sendMessage(idGrupo, { text: `✅ *Salvo!*\n\n*${titulo}*\n📅 ${dataCompleta}\n\nVou avisar aqui todo dia a partir de 5 dias antes às 08:00!` })
      }

      if(txtLower === "gergelim lista" || txtLower === "lista"){
        const agenda = getAgenda()
        if(agenda.length === 0) await sock.sendMessage(idGrupo, { text: "Agenda vazia" })
        else{
          let msg = "*GERGELIM - Agenda do Davi* 👶\n\n"
          agenda.forEach((a,i)=>{ msg += `${i+1}. ${a.data} - ${a.titulo}\n` })
          msg += `\nPara adicionar: gergelim agenda 15/10 09:00 Pediatra`
          await sock.sendMessage(idGrupo, { text: msg })
        }
      }

      if(txtLower.startsWith("gergelim apagar") || txtLower.startsWith("apagar ")){
        const termo = texto.replace(/gergelim apagar|apagar /i,"").trim().toLowerCase()
        let agenda = getAgenda()
        const antes = agenda.length
        agenda = agenda.filter(a=>!a.titulo.toLowerCase().includes(termo))
        salvarAgenda(agenda)
        if(agenda.length < antes) await sock.sendMessage(idGrupo, { text: `🗑️ Apagado tudo com: *${termo}*` })
        else await sock.sendMessage(idGrupo, { text: `Não achei nada com: ${termo}` })
      }

    }catch(e){ console.log("Erro msg:", e) }
  })

  cron.schedule('0 8 * * *', async () => {
    try {
      const grupos = await sock.groupFetchAllParticipating()
      const grupo = Object.values(grupos).find(g => g.subject === NOME_GRUPO)
      if (grupo) await enviarLembretes(grupo.id)
    } catch(e){ console.log("Erro cron:", e) }
  }, { timezone: "America/Sao_Paulo" })
}
iniciar()
