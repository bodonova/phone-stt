
const server = require('http').createServer()
const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const fs = require('fs')
const extend = require('util')._extend
const watson = require('watson-developer-cloud')
const TextToSpeechV1 = require('watson-developer-cloud/text-to-speech/v1');
const WebSocket = require('ws');
const WebSocketServer = require('ws').Server
const ws_phone = new WebSocketServer({ server: server })
const websocketStream = require('websocket-stream');


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
var textToSpeech = new TextToSpeechV1({
  username: tts_credentials.username,
  password: tts_credentials.password
});

// const model = 'fr-FR_BroadbandModel';
const model = 'en-US_NarrowbandModel';
// const model = 'en-US_BroadandModel';
const my_voice = 'en-US_LisaVoice';

var stt_connected = false;
var stt_ws = null;

var n = stt_credentials.url.indexOf('://')
var stt_ws_url = 'wss'+stt_credentials.url.substring(n)+'/v1/recognize?&watson-token='
console.log('Base STT WS url', stt_ws_url)

// Read a file and stream it to a socket
function unused_streamFile (file_name, socket) {
  const buf_size = 640;
  const OutBuf = new Buffer(buf_size)
  fs.readFile(file_name, function (err, data) {
    if (err) throw err;
    console.log(data);
    if (data.length < 640) {
      // if it is short enough just write it
      socket.send(data);
    } else {
      // If it is longer send it out in chunks
      var curr_in_byte = 0;
      var curr_out_byte = 0;
      while (curr_in_byte < data.length) {
        OutBuf[curr_out_byte] = data[curr_in_byte];
        curr_in_byte++;
        curr_out_byte++;
        if (buf_size == curr_out_byte) {
          // console.log('Sending bytes up to', curr_in_byte);
          if (socket) socket.send(OutBuf);
          curr_out_byte = 0;
        }
      }
      console.log('Loop ended with', curr_in_byte,'send . Send remaining bytes', curr_out_byte);
      while (curr_out_byte < OutBuf.length) {
        OutBuf[curr_out_byte] = 0;
        curr_out_byte++;
      }
      if (socket) socket.send(OutBuf);
    }
  });
}

// streamFile('greeting.wav', null)

app.use(express.static('static'))
app.enable('trust proxy')

app.get('/answer', (req, res) => {
  console.log('GET on /answer')

  const conn_id = Math.random().toString().substr(2,4)
  const ws_url =
    // (req.secure ? 'wss' : 'ws') + '://' +
    'ws://' +
    req.headers.host + '/server/' + conn_id
  console.log('ws_url:', ws_url)

  res.send([
    {
      action: 'talk',
      text: 'Speak to Watson'
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

ws_phone.on('connection', ws => {
  console.log('WebSocket connected at '+(new Date).toISOString())
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
      console.log('STT connection opened at '+(new Date).toISOString())
      stt_connected  = true;
      audio_json = {
        'action': 'start',
        'content-type': 'audio/l16;rate=16000',
        'interim_results': true,
        'inactivity_timeout': -1, 
        // 'continuous': true,
        'word_confidence': true,
        'timestamps': true,
        'max_alternatives': 3
      };
      stt_ws.send(JSON.stringify(audio_json))
    });
    stt_ws.on('message', message => {
        console.log('Message from STT', message)
        try {
          var json = JSON.parse(message);
          console.log("JSON from STT:", json);
          if (json.error) {
            console.error((new Date).toISOString()+' STT Error:',json.error);
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
              var synthesizeParams = {
                text: send_to_tts,
                // accept: 'audio/wav',
                accept: 'audio/l16;rate=16000',
                voice: 'en-US_AllisonVoice'
              };
              
              // Pipe the synthesized text to a file.
              try  {
                console.log('Got', message.length, 'bytes of audio from TTS');
                var in_buf_pos = 0;
                var out_buf_pos = 0;
                var response_buf = Buffer.alloc(640);
                // const out_buf_size = 640;
                // var response_buf = new Buffer(out_buf_size);
                while (in_buf_pos < message.length) {
                  response_buf[out_buf_pos] = message[in_buf_pos];
                  out_buf_pos++;
                  in_buf_pos++;
                  if (response_buf.length == out_buf_pos) {
                    ws.send(response_buf);
                    out_buf_pos = 0;
                  }
                }
                // send the last part of the buffer
                console.log('Got to end of loop with', out_buf_pos, 'bytes left');
                while (out_buf_pos < response_buf.length) {
                  response_buf[out_buf_pos] = 0;
                  out_buf_pos++;
                }
                ws.send(response_buf);
              } catch (e) {
                console.error("Error calling TTS", e);
              }
      ;
          } else {
              console.log('Ignore interim result', transcript)
            }
          }
        } catch (e) {
          console.log((new Date).toISOString()+' this STT response is not a valid JSON: ', message);
          return;
        }
    });
  });

  ws.on('open',  () => {
   // streamFile('greeting.wav', ws);
    const src = fs.createReadStream('greeting.wav');
    src.pipe(ws);
  });

  ws.on('message', data => {
    if (stt_connected) {
      // console.log('Sending received audio to STT')
      stt_ws.send(data)
    } else {
      // console.log('Ignore this audio because STT is not yet connected')
    }
  });

  ws.on('close', () => {
    stt_connected = false
    console.log((new Date).toISOString()+' phone WebSocket closing')
    try {
      if (stt_ws) {
        stt_ws.close();
        console.log('Closed STT websocket at '+(new Date).toISOString());
      }
    } catch (e) {
      console.log('Unable to close STT websocket - it must be closed already');
    }
  })

});

server.on('request', app)

server.listen(process.env.PORT || 3001, () => {
  console.log('Listening on ' + server.address().port)
})
