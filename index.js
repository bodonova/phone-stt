
const server = require('http').createServer()
const WebSocketServer = require('ws').Server
const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const ws_phone = new WebSocketServer({ server: server })
const fs = require('fs')
const extend = require('util')._extend
const watson = require('watson-developer-cloud')
const WebSocket = require('ws');

// When running on Bluemix we will get config data from VCAP_SERVICES
// and a user variable named VCAP_SERVICES
// When running locally we will read config from 'vcap-local.json'
var vcapServices = process.env.VCAP_SERVICES;
if (!vcapServices) {
  console.log ("No VCAP_SERVICES variable so create empty one")
  vcapServices = {};
} else {
  vcapServices = JSON.parse(vcapServices);
  console.log("Data from process.env.VCAP_SERVICES:", JSON.stringify(vcapServices));
}
if (fs.existsSync("vcap-local.json")) {
  //When running locally, the VCAP_SERVICES will not be set so read from vcap-local.json
  // console.log ("Original env data "+JSON.stringify(vcapServices));
  var jsonData = fs.readFileSync("vcap-local.json", "utf-8");
  // console.log ("vcap-local.json contents\n"+jsonData);
  var localJSON = JSON.parse(jsonData);
  console.log ("Parsed local data:", JSON.stringify(localJSON));
  vcapServices = extend(vcapServices,localJSON.VCAP_SERVICES);
}
console.log("Merged vcapServices:", JSON.stringify(vcapServices));
var stt_credentials = {
  version: 'v1',
  url: vcapServices.speech_to_text[0].credentials.url,
  username: vcapServices.speech_to_text[0].credentials.username,
  password: vcapServices.speech_to_text[0].credentials.password
};
var stt_auth = watson.authorization(stt_credentials);
var tts_credentials = {
  version: 'v1',
  url: vcapServices.text_to_speech[0].credentials.url,
  username: vcapServices.text_to_speech[0].credentials.username,
  password: vcapServices.text_to_speech[0].credentials.password
};
var tts_auth = watson.authorization(tts_credentials);


// const model = 'fr-FR_BroadbandModel';
const model = 'en-US_NarrowbandModel';
// const model = 'en-US_BroadandModel';
const my_voice = 'en-US_LisaVoice';


app.use(express.static('static'))
app.enable('trust proxy')

app.get('/answer', (req, res) => {
  console.log('GET on /answer')

  const conn_id = Math.random().toString().substr(2,4)
  const ws_url =
    (req.secure ? 'wss' : 'ws') + '://' +
    req.headers.host + '/server/' + conn_id
  console.log('ws_url:', ws_url)

  old_text = 'Enter that code on your screen now'
  long_text = 'Welcome to the Watson phone based speech recognition demo. Say what you like and when you pause Watson will tell you what it heard'
  short_text = 'speak to see if Watson understands you'

  res.send([
    {
      action: 'talk',
      text: short_text
    },
    {
      'action': 'connect',
      'endpoint': [
        {
          'type': 'websocket',
          'uri': ws_url,
          'content-type': 'audio/l16;rate=16000',
          'headers': {}
        }
      ]
    }
  ])

})

app.post('/event', bodyParser.json(), (req, res) => {
  console.log('POST to event>', req.body)
  res.sendStatus(200)
})

var n = stt_credentials.url.indexOf('://')
// TODO figure out why we see timeout even when set to -1
//var stt_ws_url = 'wss'+stt_credentials.url.substring(n)+'/v1/recognize?inactivity_timeout=-1&watson-token='
var stt_ws_url = 'wss'+stt_credentials.url.substring(n)+'/v1/recognize?inactivity_timeout=20&watson-token='
console.log('Base STT WS url', stt_ws_url)
n = tts_credentials.url.indexOf('://')
var tts_ws_url = 'wss'+tts_credentials.url.substring(n)+'/v1/synthesize&voice='+my_voice+'&watson-token='
console.log('Base TTS WS url', tts_ws_url)

var stt_connected = false;
var stt_ws = null;
var tts_connected = false;
var tts_ws = null;


ws_phone.on('connection', ws => {
  console.log('WebSocket connected')
  const url = ws.upgradeReq.url
  console.log('url:', url)

  stt_auth.getToken({url: stt_credentials.url}, (error, response) => {
    if (error) {
      console.log(error)
      reject(error)
    }
    console.log("STT token", response)
    this_stt_ws_url = stt_ws_url+response+'&model='+model
    console.log('STT WS url:', stt_ws_url)
    stt_ws = new WebSocket(this_stt_ws_url);
    
    stt_ws.on('open', () => {
      console.log('STT connection opened')
      stt_connected  = true;
      audio_json = {
        'action': 'start',
        'content-type': 'audio/l16;rate=16000',
        'interim_results': true,
        'continuous': true,
        'word_confidence': true,
        'timestamps': true,
        'max_alternatives': 3
      };
      stt_ws.send(JSON.stringify(audio_json))
    });
    stt_ws.on('message', message => {
        // console.log('Message from STT', message)
        try {
          var json = JSON.parse(message);
          // console.log("JSON from STT:", json);
          if (json.error) {
            console.error('STT Error:',json.error);
            stt_connected = false
            try {
              ws.close(); // end the call
            } catch (e) {}
            return;
          } else if (json.state === 'listening') {
            console.log('Watson is listening to you')
          } else {
            // console.log('STT transcription:', json)
            transcript = json.results[0].alternatives[0].transcript
            if (json.results[0].final) {
              send_to_tts = 'Watson heard: '+transcript
              console.log('Saying', send_to_tts)
              if (tts_connected) {
                var message = {
                  text: send_to_tts,
                  accept: '*/*'
                };
                //tts_ws.send(JSON.stringify(message));
              }
            } else {
              console.log('Ignore interim result', transcript)
            }
          }
        } catch (e) {
          console.log('This STT response is not a valid JSON: ', message);
          return;
        }
    });
  });

  tts_auth.getToken({url: tts_credentials.url}, (error, response) => {
    if (error) {
      console.log(error)
      reject(error)
    }
    console.log("TTS token", response)
    this_tts_ws_url = tts_ws_url+response
    console.log('TTS WS url:', tts_ws_url)
    // tts_ws = new WebSocket(this_tts_ws_url);
    
    // tts_ws.on('open', () => {
    //   console.log('TTS connection opened')
    //   tts_connected  = true;
    // });
  //   tts_ws.on('message', message => {
  //       console.log('Message from TTS', message)
  //       //ws_phone.send(message);
  //   });
  });

  ws.on('message', data => {
    if (stt_connected) {
      // console.log('Sending received audio to STT')
      stt_ws.send(data)
    } else {
      // console.log('Ignore this audio because STT is not yet connected')
    }
  })

  ws.on('close', () => {
    stt_connected = false
    tts_connected = false
    console.log('Phone WebSocket closing')
    try {
      if (stt_ws) {
        stt_ws.close();
        console.log('Closed STT websocket');
      }
    } catch (e) {
      console.log('Unable to close STT websocket - it must be closed already');
    }
    try {
      if (tts_ws) {
        tts_ws.close();
        console.log('Closed TTS websocket');
      }
    } catch (e) {
      console.log('Unable to close TTS websocket - it must be closed already');
    }
  })

})

server.on('request', app)

server.listen(process.env.PORT || 3000, () => {
  console.log('Listening on ' + server.address().port)
})
