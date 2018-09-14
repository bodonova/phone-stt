# ws-phone

Connect a phone call via Nexmo to IBM Watson Speech To Text(STT) and Text To Speech (TTS)

This is a simple test for how well the STT is working from your phone call. Everytime you say something, as soon s you pause the STT will try to recognize wht you said and then speak it back to you via TTS.

## Requirements

* [node](https://nodejs.org/en/) & [yarn](https://yarnpkg.com)
* a publicly available host to run your application (IBM Cloud works pretty well)
* a Nexmo number and associated app with the following endpoints:
  * `answer`: https://YOUR_URL/answer
  * `event`: https://YOUR_URL/event

## Running

First install dependencies (npm would work too)

```bash
yarn install
```

Then start the application

```bash
node index.js
```

## How this works

This makes use of a Nexmo feature of connecting a voice call to a [WebSocket endpoint](https://docs.nexmo.com/voice/voice-api/websockets).  The node server listens out for incoming websocket connections and connects them to IBM Watson STT and TTS.

Click [here](https://watson-tricks.blogspot.com/2018/09/connecting-ibm-watson-speech-services.html) to access a blog post giving details of how this app works.
