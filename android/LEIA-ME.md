# Fixa para Android (APK)

Uma casca mínima: o APK leva o site inteiro dentro (pasta `assets`) e o abre num navegador embutido. Não há outro
código de app. **Não tem a permissão de internet**, então não consegue enviar dado nenhum; a única permissão é o
microfone, para gravar áudio no cartão. O backup automático do Android para a conta Google também está desligado.

## Montar

```bash
FIXA_KEYSTORE=/caminho/fixa.keystore FIXA_KEYSTORE_SENHA=... bash android/montar.sh
# ou: FIXA_ENV=/caminho/.env bash android/montar.sh   (o .env com as duas variáveis)
```

Sai em `android/saida/fixa-<versão>.apk`. Precisa de JDK 17, Android SDK (plataforma 34 + build-tools 34.0.0) e
Gradle 8.7; por padrão o script procura em `%LOCALAPPDATA%\Android` (mude com `FIXA_FERRAMENTAS`).

Para criar uma chave (uma vez só):

```bash
keytool -genkeypair -keystore fixa.keystore -storetype PKCS12 -alias fixa -keyalg RSA -keysize 2048 -validity 10950
```

## A chave de assinatura

**Nunca entra no repositório.** O Android só aceita atualizar o app por cima se o APK novo tiver a mesma assinatura.
Sem a chave, a saída é desinstalar — e desinstalar apaga os cartões, que só existem no aparelho. Antes de qualquer
reinstalação: Ajustes → Baixar backup.

## Atualizar o app

1. Mude o site (pasta de cima) e rode os testes.
2. Suba `versionCode` (e `versionName`) em `app/build.gradle`.
3. `bash android/montar.sh` e instale o APK novo por cima. Os cartões ficam.

## O que a casca faz que o navegador embutido não faz sozinho

`MainActivity.java`: escolher arquivo (imagem, áudio, backup), pedir o microfone, salvar o backup num arquivo
(`FixaAndroid.salvarBackup`) e o botão voltar do celular. O site reconhece o APK por `window.FixaAndroid`.
`teste/apk_ponte.py` simula essa ponte no navegador.
