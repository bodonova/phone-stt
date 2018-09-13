
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


// const model = 'fr-FR_BroadbandModel';
const model = 'en-US_NarrowbandModel'; // for STT
// const model = 'en-US_BroadandModel';
const my_voice = 'en-US_LisaVoice'; // for TTS

const audio_format =  'audio/l16;rate=8000' // ;channels=1;endianness=little-endian';
const BUF_SIZE = 320; // a 20msec chunk - would be 640 for 16KHz
// const audio_format =  'audio/l16;rate=16000' 
// const BUF_SIZE = 6400; // a 20msec chunk - would be 320 for 8KHz

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

var stt_connected = false;
var stt_ws = null;

var n = stt_credentials.url.indexOf('://')
var stt_ws_url = 'wss'+stt_credentials.url.substring(n)+'/v1/recognize?&watson-token='
console.log('Base STT WS url', stt_ws_url)

var curr_send_buff = 0;
var curr_fill_buff = 0;
var data_ended = false;
var buf_array = [];

// Send audio to the websocket (if we have a full buffer)
function stream_data_if_ready(socket) {
  if (data_ended && (curr_send_buff == curr_fill_buff)) {
    console.log('Closing send loop since all audio sent'+(new Date).toISOString());
    // send last buffer
    socket.send(buf_array[curr_send_buff]);
  } else {
    setTimeout(stream_data_if_ready, 20, socket);
  }

  if (curr_fill_buff > curr_send_buff) {
    console.log('Sending data from buffer', curr_send_buff, 'at '+(new Date).toISOString());
    socket.send(buf_array[curr_send_buff]);
    curr_send_buff++;
  } else {
    // console.log('No full buffer to send at'+(new Date).toISOString());
;  }
}

// Send a strng to TTS and stream the response to the phone socket
function tts_stream (text, socket) {
  console.log('Calling TTS to Say:', text)
  var synthesizeParams = {
    text: text,
    accept: audio_format+';channels=1;endianness=little-endian',
    voice: 'en-US_AllisonVoice'
  };
  const audio_req = textToSpeech.synthesize(synthesizeParams);
  // console.log('TTS response coming');

  var buf_pos = 0;
  curr_send_buff = 0;
  curr_fill_buff = 0;
  data_ended = false;
  buf_array = [];
  buf_array.push(Buffer.alloc(BUF_SIZE));
  stream_data_if_ready(socket);

  audio_req.on('data', (data) => {
    console.log(data);
    var in_buf_pos = 0;
    var end_pos = buf_pos + data.length;
    console.log('curr_fill_buff', curr_fill_buff, 'data.length', data.length, 'buf_pos', buf_pos, 'in_buf_pos', in_buf_pos);
    if (BUF_SIZE <= end_pos) {
      // console.log('New data would put us at or beyond buffer ar', end_pos);
      while (buf_pos < BUF_SIZE) {
        buf_array[curr_fill_buff][buf_pos] = data[in_buf_pos];
        buf_pos++;
        in_buf_pos++;
      }
      //socket.send(buf_array[curr_fill_buff]);

      // Now fill the next buffer
      buf_array.push(Buffer.alloc(BUF_SIZE));
      curr_fill_buff++;
      end_pos -= BUF_SIZE;
      buf_pos = 0;
      while (in_buf_pos < end_pos) {
        buf_array[curr_fill_buff][buf_pos] = data[in_buf_pos];
        in_buf_pos++;
        buf_pos++;
      }
    } else {
      while (buf_pos < end_pos) {
        buf_array[curr_fill_buff][buf_pos] = data[in_buf_pos];
        buf_pos++;
        in_buf_pos++;
      }
      in_buf_pos = 0;
    }
  });

  audio_req.on('end', () => {
    console.log('You have all the data you are going to get');
    data_ended = true;
  });
}

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
      text: 'Please give Watson a moment to prepare'
    },
    {
      'action': 'connect',
      'endpoint': [
        {
          'type': 'websocket',
          'uri': ws_url,
          'content-type': audio_format,
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
  console.log('url:', url);

  // Play greeting to verify audio will sream OK


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
        'content-type': audio_format,
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
            var greeting = 'Mr Watson is listening to you so go ahead and speak';
            console.log('Greeting:', greeting);
            tts_stream (greeting, ws);
          } else {
            // console.log('STT transcription:', json)
            transcript = json.results[0].alternatives[0].transcript
            if (json.results[0].final) {
              send_to_tts = 'Watson heard: '+transcript
              tts_stream(send_to_tts, ws);
            } else {
                console.log('Ignore interim result', transcript)
            }
          }
       } catch (e) {
          console.log('Error parsing STT response', e)
      }
    });

  });

  ws.on('message', data => {
    if (stt_connected) {
      //console.log('Sending', data.length,' of received audio to STT');
      stt_ws.send(data);
    } else {
      //console.log('Ignore this audio because STT is not yet connected', data.length);
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
