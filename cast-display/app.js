// ============================================
// Cast Display - webOS TV App
// WebSocket-based Cast receiver display surface
// ============================================

'use strict';

// ---- Configuration ----

var Config = {
  WS_PORT: 8010,
  STATUS_INTERVAL_MS: 1000,
  RECONNECT_BASE_MS: 1000,
  RECONNECT_MAX_MS: 30000,
  // Hide connection banner after connected for this long
  CONNECTED_BANNER_MS: 3000,

  getBridgeHost: function () {
    var params = new URLSearchParams(window.location.search);
    return params.get('bridge') || window.location.hostname || 'localhost';
  },

  getWsUrl: function () {
    return 'ws://' + this.getBridgeHost() + ':' + this.WS_PORT;
  }
};

// ---- Player State Constants ----

var PlayerState = {
  IDLE: 'IDLE',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  BUFFERING: 'BUFFERING'
};

// ---- Screen Manager ----

var ScreenManager = (function () {
  var screens = {};
  var currentScreen = null;

  function init() {
    var els = document.querySelectorAll('.screen');
    for (var i = 0; i < els.length; i++) {
      screens[els[i].id] = els[i];
    }
  }

  function show(screenId) {
    if (currentScreen === screenId) return;
    for (var id in screens) {
      if (screens.hasOwnProperty(id)) {
        screens[id].classList.remove('active');
      }
    }
    if (screens[screenId]) {
      screens[screenId].classList.add('active');
      currentScreen = screenId;
    }
  }

  return { init: init, show: show };
})();

// ---- Connection Status UI ----

var ConnectionUI = (function () {
  var el = null;
  var textEl = null;
  var hideTimer = null;

  function init() {
    el = document.getElementById('connection-status');
    textEl = document.getElementById('status-text');
  }

  function show(text, connected) {
    clearTimeout(hideTimer);
    textEl.textContent = text;
    el.classList.remove('hidden', 'visible', 'connected');
    el.classList.add('visible');
    if (connected) {
      el.classList.add('connected');
      // Auto-hide after a few seconds when connected
      hideTimer = setTimeout(function () {
        el.classList.remove('visible');
        el.classList.add('hidden');
      }, Config.CONNECTED_BANNER_MS);
    }
  }

  function hide() {
    clearTimeout(hideTimer);
    el.classList.remove('visible');
    el.classList.add('hidden');
  }

  return { init: init, show: show, hide: hide };
})();

// ---- Media Player ----

var MediaPlayer = (function () {
  var video = null;
  var state = PlayerState.IDLE;
  var onStateChange = null;

  function init(stateCallback) {
    video = document.getElementById('video-player');
    onStateChange = stateCallback;
    _bindEvents();
  }

  function _bindEvents() {
    video.addEventListener('playing', function () {
      _setState(PlayerState.PLAYING);
    });

    video.addEventListener('pause', function () {
      if (!video.ended) {
        _setState(PlayerState.PAUSED);
      }
    });

    video.addEventListener('waiting', function () {
      _setState(PlayerState.BUFFERING);
    });

    video.addEventListener('ended', function () {
      _setState(PlayerState.IDLE);
      ScreenManager.show('idle-screen');
    });

    video.addEventListener('error', function () {
      var err = video.error;
      var msg = 'Unknown playback error';
      if (err) {
        switch (err.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            msg = 'Playback aborted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            msg = 'Network error during playback';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            msg = 'Media decode error';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            msg = 'Media format not supported';
            break;
        }
      }
      _setState(PlayerState.IDLE);
      _showError(msg);
    });

    video.addEventListener('loadeddata', function () {
      // Content loaded, switch to player screen if we were loading
      ScreenManager.show('player-screen');
    });
  }

  function _setState(newState) {
    if (state !== newState) {
      state = newState;
      if (onStateChange) onStateChange(newState);
    }
  }

  function _showError(message) {
    document.getElementById('error-message').textContent = message;
    ScreenManager.show('error-screen');
  }

  function load(url, contentType) {
    console.log('[MediaPlayer] load:', url, contentType);
    ScreenManager.show('loading-screen');
    _setState(PlayerState.BUFFERING);

    // Reset video element
    video.pause();
    video.removeAttribute('src');
    video.load();

    if (contentType) {
      video.setAttribute('type', contentType);
    }
    video.src = url;
    video.load();

    var playPromise = video.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function (err) {
        console.warn('[MediaPlayer] Auto-play failed:', err.message);
        // On webOS, autoplay should work since the app is foreground.
        // If it fails, we stay on loading screen until a play command arrives.
      });
    }
  }

  function play() {
    console.log('[MediaPlayer] play');
    if (video.src) {
      video.play();
    }
  }

  function pause() {
    console.log('[MediaPlayer] pause');
    video.pause();
  }

  function seek(time) {
    console.log('[MediaPlayer] seek:', time);
    if (isFinite(time)) {
      video.currentTime = time;
    }
  }

  function stop() {
    console.log('[MediaPlayer] stop');
    video.pause();
    video.removeAttribute('src');
    video.load();
    _setState(PlayerState.IDLE);
    ScreenManager.show('idle-screen');
  }

  function setVolume(level) {
    console.log('[MediaPlayer] volume:', level);
    // Clamp to 0.0 - 1.0
    video.volume = Math.max(0, Math.min(1, level));
  }

  function getStatus() {
    return {
      playerState: state,
      currentTime: video.currentTime || 0,
      duration: (isFinite(video.duration) ? video.duration : 0),
      volume: video.volume
    };
  }

  return {
    init: init,
    load: load,
    play: play,
    pause: pause,
    seek: seek,
    stop: stop,
    setVolume: setVolume,
    getStatus: getStatus
  };
})();

// ---- Mirror Player (WebRTC) ----

var MirrorPlayer = (function () {
  var peerConnection = null;
  var currentSessionId = null;
  var mirrorVideo = null;
  var indicatorEl = null;

  function _getMirrorVideo() {
    if (!mirrorVideo) {
      mirrorVideo = document.getElementById('mirror-player');
    }
    return mirrorVideo;
  }

  function _resetIndicator() {
    if (!indicatorEl) {
      indicatorEl = document.querySelector('.mirror-indicator');
    }
    if (indicatorEl) {
      // Re-trigger the fade animation by removing and re-adding the element
      var parent = indicatorEl.parentNode;
      var clone = indicatorEl.cloneNode(true);
      parent.replaceChild(clone, indicatorEl);
      indicatorEl = clone;
    }
  }

  function handleOffer(sessionId, sdp) {
    console.log('[MirrorPlayer] Received offer for session:', sessionId);

    // Clean up any existing connection
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    currentSessionId = sessionId;

    var config = {
      iceServers: [],
      sdpSemantics: 'unified-plan'
    };

    peerConnection = new RTCPeerConnection(config);

    peerConnection.ontrack = function (event) {
      console.log('[MirrorPlayer] Remote track received:', event.track.kind);
      var vid = _getMirrorVideo();
      if (event.streams && event.streams[0]) {
        vid.srcObject = event.streams[0];
      } else {
        // Fallback: create a MediaStream from the track
        if (!vid.srcObject) {
          vid.srcObject = new MediaStream();
        }
        vid.srcObject.addTrack(event.track);
      }
      _resetIndicator();
      ScreenManager.show('mirror-screen');
    };

    peerConnection.onicecandidate = function (event) {
      if (event.candidate) {
        console.log('[MirrorPlayer] Sending ICE candidate');
        BridgeConnection.send({
          type: 'ice-candidate',
          sessionId: currentSessionId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.onconnectionstatechange = function () {
      console.log('[MirrorPlayer] Connection state:', peerConnection.connectionState);
      var state = peerConnection.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        stop();
      }
    };

    var offer = new RTCSessionDescription({ type: 'offer', sdp: sdp });

    peerConnection.setRemoteDescription(offer)
      .then(function () {
        return peerConnection.createAnswer();
      })
      .then(function (answer) {
        return peerConnection.setLocalDescription(answer);
      })
      .then(function () {
        console.log('[MirrorPlayer] Sending answer');
        BridgeConnection.send({
          type: 'webrtc-answer',
          sessionId: currentSessionId,
          sdp: peerConnection.localDescription.sdp
        });
      })
      .catch(function (err) {
        console.error('[MirrorPlayer] WebRTC negotiation failed:', err);
        stop();
      });
  }

  function handleIceCandidate(sessionId, candidate) {
    if (!peerConnection || sessionId !== currentSessionId) {
      console.warn('[MirrorPlayer] Ignoring ICE candidate for unknown session');
      return;
    }
    console.log('[MirrorPlayer] Adding ICE candidate');
    var iceCandidate = new RTCIceCandidate(candidate);
    peerConnection.addIceCandidate(iceCandidate).catch(function (err) {
      console.warn('[MirrorPlayer] Failed to add ICE candidate:', err);
    });
  }

  function stop() {
    console.log('[MirrorPlayer] Stopping');
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    currentSessionId = null;

    var vid = _getMirrorVideo();
    if (vid.srcObject) {
      var tracks = vid.srcObject.getTracks();
      for (var i = 0; i < tracks.length; i++) {
        tracks[i].stop();
      }
      vid.srcObject = null;
    }

    ScreenManager.show('idle-screen');
  }

  return {
    handleOffer: handleOffer,
    handleIceCandidate: handleIceCandidate,
    stop: stop
  };
})();

// ---- WebSocket Bridge Connection ----

var BridgeConnection = (function () {
  var ws = null;
  var reconnectDelay = Config.RECONNECT_BASE_MS;
  var reconnectTimer = null;
  var statusTimer = null;
  var connected = false;

  function connect() {
    var url = Config.getWsUrl();
    console.log('[Bridge] Connecting to', url);
    ConnectionUI.show('Connecting to bridge...', false);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error('[Bridge] WebSocket creation failed:', err);
      _scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      console.log('[Bridge] Connected');
      connected = true;
      reconnectDelay = Config.RECONNECT_BASE_MS;
      ConnectionUI.show('Connected', true);
      _startStatusReporting();
    };

    ws.onmessage = function (event) {
      _handleMessage(event.data);
    };

    ws.onclose = function (event) {
      console.log('[Bridge] Disconnected, code:', event.code);
      _onDisconnect();
    };

    ws.onerror = function (err) {
      console.error('[Bridge] WebSocket error');
      // onclose will fire after onerror, so reconnect is handled there
    };
  }

  function _onDisconnect() {
    connected = false;
    _stopStatusReporting();
    ws = null;
    ConnectionUI.show('Disconnected - reconnecting...', false);
    _scheduleReconnect();
  }

  function _scheduleReconnect() {
    clearTimeout(reconnectTimer);
    console.log('[Bridge] Reconnecting in', reconnectDelay, 'ms');
    reconnectTimer = setTimeout(function () {
      connect();
    }, reconnectDelay);
    // Exponential backoff
    reconnectDelay = Math.min(reconnectDelay * 2, Config.RECONNECT_MAX_MS);
  }

  function _handleMessage(raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      console.warn('[Bridge] Invalid JSON:', raw);
      return;
    }

    console.log('[Bridge] Received:', msg.type, msg);

    switch (msg.type) {
      case 'load':
        MediaPlayer.load(msg.url, msg.contentType);
        break;

      case 'play':
        MediaPlayer.play();
        break;

      case 'pause':
        MediaPlayer.pause();
        break;

      case 'seek':
        MediaPlayer.seek(msg.currentTime);
        break;

      case 'stop':
        MediaPlayer.stop();
        break;

      case 'volume':
        MediaPlayer.setVolume(msg.level);
        break;

      case 'webrtc-offer':
        MirrorPlayer.handleOffer(msg.sessionId, msg.sdp);
        break;

      case 'ice-candidate':
        MirrorPlayer.handleIceCandidate(msg.sessionId, msg.candidate);
        break;

      case 'mirror-stop':
        MirrorPlayer.stop();
        break;

      default:
        console.warn('[Bridge] Unknown message type:', msg.type);
    }
  }

  function _send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function _startStatusReporting() {
    _stopStatusReporting();
    statusTimer = setInterval(function () {
      var status = MediaPlayer.getStatus();
      status.type = 'status';
      _send(status);
    }, Config.STATUS_INTERVAL_MS);
  }

  function _stopStatusReporting() {
    clearInterval(statusTimer);
    statusTimer = null;
  }

  return { connect: connect, send: _send };
})();

// ---- App Entry Point ----

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    console.log('[CastDisplay] Initializing...');

    ScreenManager.init();
    ConnectionUI.init();
    MediaPlayer.init(function (newState) {
      console.log('[CastDisplay] Player state:', newState);
    });

    // Show idle screen on start
    ScreenManager.show('idle-screen');

    // Connect to bridge
    BridgeConnection.connect();

    console.log('[CastDisplay] Ready. Bridge:', Config.getWsUrl());
  });
})();
