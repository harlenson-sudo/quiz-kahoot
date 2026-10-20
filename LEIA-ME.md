# Quiz ao vivo (estilo Kahoot)

## Como funciona
1. O professor abre `/host` no telão e aparece o **QR Code**.
2. Os alunos escaneiam, digitam o **nome** e entram na sala de espera (o nome aparece no telão).
3. O professor clica em **Iniciar quiz**. A pergunta aparece no telão e no celular, com 4 opções coloridas e um cronômetro.
4. A pergunta termina quando o tempo acaba ou quando todos respondem (o professor também pode encerrá-la antes).
5. Depois de cada pergunta: o telão mostra a resposta certa, quantos marcaram cada opção e o **ranking (top 10)**. Cada aluno vê no celular se acertou, quantos pontos ganhou e em que posição está.
6. No fim aparece o **ranking final**.

Pontuação: quem acerta ganha de 500 a 1000 pontos, e quanto mais rápido responder, mais pontos ganha. Quem erra ganha 0.

## Editar as perguntas
Edite o arquivo `questions.json`. `correta` é o índice da opção certa e começa em 0 (0 = 1ª opção, 1 = 2ª…). `tempo` é em segundos.

## Rodar no computador
```bash
npm install
npm start
```
- Alunos: http://localhost:3000
- Professor: http://localhost:3000/host?key=professor123

## Colocar online (os alunos precisam de um endereço público)
**Opção A, hospedagem gratuita ou barata (Render, Railway, Fly.io):** envie a pasta e configure estas variáveis:
- `PUBLIC_URL=https://seu-app.onrender.com` (é o endereço que vai no QR Code)
- `HOST_KEY=sua-senha-secreta`

**Opção B, rodar no seu computador e abrir um túnel:**
```bash
npx cloudflared tunnel --url http://localhost:3000
# copie o https://xxxx.trycloudflare.com gerado e reinicie com:
PUBLIC_URL=https://xxxx.trycloudflare.com HOST_KEY=minhasenha npm start
```

## Capacidade
Foi testado com 150 participantes simultâneos em 4 perguntas, e todos receberam as perguntas, os resultados e o ranking. Um servidor simples aguenta várias centenas de participantes.
