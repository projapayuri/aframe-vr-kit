/* vr-kit 0.3.4：A-Frameの後に読み込む。 */
if (typeof AFRAME === 'undefined') {
  throw new Error('[vr-kit] A-Frameが見つかりません。aframe.min.jsをvr-kit.jsより先に読み込んでください。');
}
const VR_KIT_VERSION = '0.3.4';

/* 2つのA-Frame要素の位置が、指定距離以内ならtrueを返す（単位：m）。 */
function isNear(first, second, distance = 2) {
  if (!first?.isConnected || !second?.isConnected ||
      !first.object3D?.isObject3D || !second.object3D?.isObject3D ||
      !first.sceneEl || first.sceneEl !== second.sceneEl ||
      !Number.isFinite(distance) || distance < 0) return false;

  // 親の位置・回転・拡大率と、ライブラリによるアバターの親変更も反映する。
  const firstPosition = first.object3D.getWorldPosition(new THREE.Vector3());
  const secondPosition = second.object3D.getWorldPosition(new THREE.Vector3());
  const actualDistance = firstPosition.distanceTo(secondPosition);
  return Number.isFinite(actualDistance) && actualDistance <= distance;
}

/* 指定した地形のX/Zにある表面の高さ（ワールドY）。着地できる面がなければnull。 */
function getGroundHeight(ground, x, z, options = 45) {
  const settings = options && typeof options === 'object' && !Array.isArray(options) ? options : null;
  const from = settings?.from;
  const fromAvatar = from?.components?.avatar;
  const maxSlope = settings ? settings.maxSlope ?? fromAvatar?.data.maxSlope ?? 45 : options;
  if (!ground?.isConnected || !ground.sceneEl || !ground.object3D?.isObject3D ||
      !Number.isFinite(x) || !Number.isFinite(z) ||
      !Number.isFinite(maxSlope) || maxSlope < 0 || maxSlope >= 90) return null;
  if (from !== undefined && (!from?.isConnected || !from.object3D?.isObject3D || from.sceneEl !== ground.sceneEl)) return null;

  function active(object) {
    for (let parent = object; parent; parent = parent.parent) {
      if (!parent.visible || parent.el?.components?.walkable?.data.enabled === false) return false;
    }
    return true;
  }
  if (!active(ground.object3D)) return null;
  ground.object3D.updateWorldMatrix(true, true);

  const meshes = [], bounds = new THREE.Box3(), meshBounds = new THREE.Box3();
  ground.object3D.traverse(function collectGroundMesh(object) {
    if (!object.isMesh || object.isSkinnedMesh || !object.geometry || !active(object)) return;
    if (object.isInstancedMesh) {
      object.computeBoundingBox();
      if (object.boundingBox) bounds.union(meshBounds.copy(object.boundingBox).applyMatrix4(object.matrixWorld));
    } else {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) bounds.union(meshBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));
    }
    meshes.push(object);
  });
  if (!meshes.length || bounds.isEmpty() ||
      !Number.isFinite(bounds.min.y) || !Number.isFinite(bounds.max.y)) return null;

  // モデル全体より上から調べるので、地形ごとに開始高度を手で指定する必要はない。
  const margin = Math.max(0.01, (bounds.max.y - bounds.min.y) * 0.000001);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(x, bounds.max.y + margin, z),
    new THREE.Vector3(0, -1, 0), 0, bounds.max.y - bounds.min.y + margin * 2
  );
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit?.face || !Number.isFinite(hit.point.y)) return null;

  const matrix = hit.object.matrixWorld.clone();
  if (hit.object.isInstancedMesh) {
    const instanceMatrix = new THREE.Matrix4();
    hit.object.getMatrixAt(hit.instanceId, instanceMatrix);
    matrix.multiply(instanceMatrix);
  }
  const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
  // 最上面が急斜面なら、その下の床へ潜り込む候補を返さない。
  if (normal.y + 1e-7 < Math.cos(THREE.MathUtils.degToRad(maxSlope))) return null;

  if (from !== undefined) {
    const components = vrGroundConnections(ground.object3D, meshes, maxSlope, bounds);
    const faceKey = value => value.object.uuid + ':' + (value.instanceId ?? -1) + ':' + value.faceIndex;
    const destination = components.get(faceKey(hit));
    if (destination === undefined) return null;
    const foot = from.object3D.getWorldPosition(new THREE.Vector3());
    const offset = fromAvatar?.data.groundOffset ?? 0;
    const step = fromAvatar?.data.stepHeight ?? 0.25;
    ray.set(new THREE.Vector3(foot.x, bounds.max.y + margin, foot.z), new THREE.Vector3(0, -1, 0));
    let start, nearest = Infinity;
    for (const value of ray.intersectObjects(meshes, false)) {
      const component = components.get(faceKey(value));
      if (component === undefined) continue;
      const difference = Math.abs(value.point.y - (foot.y - offset));
      if (difference < nearest) { start = component; nearest = difference; }
    }
    // 上に屋根があっても、足元に近い面を出発面にする。
    if (nearest > step + 0.001 || start !== destination) return null;
  }
  return hit.point.y;
}

/* 足元と同じ、辺でつながる緩い面だけを候補にする。モデル名や固定のYには依存しない。 */
const vrGroundConnectionCache = new WeakMap();
function vrGroundConnections(root, meshes, maxSlope, bounds) {
  const records = meshes.map(mesh => ({
    mesh, geometry: mesh.geometry, position: mesh.geometry.attributes.position, index: mesh.geometry.index,
    positionVersion: mesh.geometry.attributes.position?.version,
    indexVersion: mesh.geometry.index?.version,
    transform: mesh.matrixWorld.elements.join(','),
    draw: mesh.geometry.drawRange.start + ':' + mesh.geometry.drawRange.count,
    groups: mesh.geometry.groups.map(g => g.start + ':' + g.count + ':' + g.materialIndex).join(','),
    material: Array.isArray(mesh.material) ? mesh.material.map(m => m?.uuid || '').join(',') : mesh.material?.uuid,
    instances: mesh.isInstancedMesh ? mesh.count + ':' + mesh.instanceMatrix.array.toString() : ''
  }));
  const cached = vrGroundConnectionCache.get(root);
  if (cached && cached.maxSlope === maxSlope && cached.records.length === records.length &&
      records.every((record, i) => Object.keys(record).every(key => record[key] === cached.records[i][key]))) return cached.components;

  const parents = [], ranks = [], faces = [], edges = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const u = new THREE.Vector3(), v = new THREE.Vector3(), normal = new THREE.Vector3();
  const epsilon = Math.max(0.000001, bounds.getSize(new THREE.Vector3()).length() * 0.0000001);
  const minimumY = Math.cos(THREE.MathUtils.degToRad(maxSlope));
  function find(id) {
    while (parents[id] !== id) { parents[id] = parents[parents[id]]; id = parents[id]; }
    return id;
  }
  function join(first, second) {
    first = find(first); second = find(second);
    if (first === second) return;
    if (ranks[first] < ranks[second]) [first, second] = [second, first];
    parents[second] = first;
    if (ranks[first] === ranks[second]) ranks[first]++;
  }
  const vertexKey = point => [point.x, point.y, point.z].map(value => Math.round(value / epsilon)).join(',');
  for (const mesh of meshes) {
    const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index;
    if (!position) continue;
    const count = index ? index.count : position.count;
    const first = Math.max(0, geometry.drawRange.start);
    const last = Math.min(count, first + geometry.drawRange.count);
    for (let instance = 0; instance < (mesh.isInstancedMesh ? mesh.count : 1); instance++) {
      const matrix = mesh.matrixWorld.clone();
      if (mesh.isInstancedMesh) {
        const instanceMatrix = new THREE.Matrix4();
        mesh.getMatrixAt(instance, instanceMatrix); matrix.multiply(instanceMatrix);
      }
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      for (let offset = first; offset + 2 < last; offset += 3) {
        if (Array.isArray(mesh.material) && !geometry.groups.some(g => offset >= g.start && offset + 2 < g.start + g.count && mesh.material[g.materialIndex])) continue;
        a.fromBufferAttribute(position, index ? index.getX(offset) : offset);
        b.fromBufferAttribute(position, index ? index.getX(offset + 1) : offset + 1);
        c.fromBufferAttribute(position, index ? index.getX(offset + 2) : offset + 2);
        normal.crossVectors(u.subVectors(b, a), v.subVectors(c, a)).applyNormalMatrix(normalMatrix);
        if (normal.y + 1e-7 < minimumY) continue;
        a.applyMatrix4(matrix); b.applyMatrix4(matrix); c.applyMatrix4(matrix);
        const vertices = [vertexKey(a), vertexKey(b), vertexKey(c)];
        const id = parents.length;
        parents.push(id); ranks.push(0);
        faces.push(mesh.uuid + ':' + (mesh.isInstancedMesh ? instance : -1) + ':' + Math.floor(offset / 3));
        for (let j = 0; j < 3; j++) {
          const pair = [vertices[j], vertices[(j + 1) % 3]].sort().join('|');
          if (edges.has(pair)) join(id, edges.get(pair));
          else edges.set(pair, id);
        }
      }
    }
  }
  const components = new Map(faces.map((key, id) => [key, find(id)]));
  vrGroundConnectionCache.set(root, { records, maxSlope, components });
  return components;
}

/* 操作中のavatarが、実際に移動しているか。呼び出しは記録を変更しない。 */
function isMoving(element) {
  if (!element?.isConnected || !element.object3D?.isObject3D) return false;
  const avatar = element.components?.avatar;
  return !!(avatar?.controls && avatar.isPlaying && !avatar.removed && avatar.moving);
}

/* WASD・矢印キーのどれかを押しているか。旋回・足踏み・反対キー同時押しも含む。 */
function isMoveKeyPressed(element) {
  if (!element?.isConnected || !element.object3D?.isObject3D) return false;
  const avatar = element.components?.avatar;
  const controls = avatar?.controls?.player.components['wasd-controls'];
  if (!avatar?.isPlaying || avatar.removed || !controls?.data.enabled) return false;
  const keys = controls.keys || {};
  return !!(keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD ||
    keys.ArrowUp || keys.ArrowLeft || keys.ArrowDown || keys.ArrowRight);
}

/* 開始位置・向きへ戻す。取得数やアイテムの状態は学生のコードで戻す。 */
function resetAvatar(element) {
  const controls = element?.components?.avatar?.controls;
  if (!controls) {
    console.warn('[vr-kit] resetAvatarには、avatarの準備が完了した要素を渡してください。');
    return false;
  }
  controls.reset();
  return true;
}

/* GLBのアニメーション名を、設定前でもConsoleで確認できるようにする。 */
(function reportGLBAnimations() {
  const reported = new WeakMap();
  function showAnimations(element) {
    // 通信で増える相手のモデルは除き、自分で配置したモデルを表示する。
    if (!element.hasAttribute('gltf-model') || element.closest('.remote-avatar')) return;
    const model = element.getObject3D('mesh');
    if (!model || reported.get(element) === model) return;
    reported.set(element, model);
    let source = element.getAttribute('gltf-model');
    if (source.startsWith('#')) source = document.getElementById(source.slice(1))?.getAttribute('src') || source;
    const clips = model.animations || [];
    console.group('[GLB] ' + source + ' — アニメーション一覧');
    if (clips.length) {
      console.table(clips.map(function animationName(clip) { return { 名前: clip.name }; }));
      console.log('walk / idle に、この名前を指定できます。');
    } else {
      console.log('アニメーションはありません。');
    }
    console.groupEnd();
  }
  function modelLoaded(event) { showAnimations(event.target); }
  function modelFailed(event) {
    const element = event.target;
    if (!element.hasAttribute('gltf-model') || element.closest('.remote-avatar')) return;
    console.warn('[GLB] ' + element.getAttribute('gltf-model') + ' を読み込めません。ファイルの場所・名前（大文字／小文字）を確認してください。Live ServerまたはNode.jsサーバーからHTMLを開いてください。');
  }
  document.addEventListener('model-loaded', modelLoaded);
  document.addEventListener('model-error', modelFailed);
  document.querySelectorAll('[gltf-model]').forEach(showAnimations);
})();

/* 配布済みライブラリ：入退室と同期。学生の通信とは vr: イベントで分ける。 */
function vrKit(options) {
  const scene = document.querySelector(options.scene);
  const camera = document.querySelector(options.camera);
  if (!scene || !camera) throw new Error('scene/camera が見つかりません');
  const player = options.player ? document.querySelector(options.player) : camera;
  const localAvatar = options.localAvatar ? document.querySelector(options.localAvatar) : null;
  if (!player) throw new Error('player が見つかりません');
  const roomName = options.room ?? 'main';
  if (typeof roomName !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(roomName)) throw new Error('部屋名は半角英数字・_・-の1〜40文字です');
  const models = options.models || { red: '/models/red.glb', blue: '/models/blue.glb', green: '/models/green.glb' };
  function hasModel(name) {
    return typeof name === 'string' && Object.hasOwn(models, name);
  }
  let selected = options.avatar || Object.keys(models)[0];
  if (!hasModel(selected)) throw new Error('未登録のアバター');
  const socket = options.socket || io({ autoConnect: false });
  const listeners = new Map();
  const others = new Map();
  let count = 0;
  let destroyed = false;
  let joined = false;
  let beginTimer;
  const worldPosition = new THREE.Vector3();
  const worldRotation = new THREE.Quaternion();
  const angles = new THREE.Euler(0, 0, 0, 'YXZ');

  function emit(name, value) {
    (listeners.get(name) || []).forEach(function notify(fn) { fn(value); });
  }
  function clear() {
    others.forEach(function removeAvatar(el) { el.remove(); });
    others.clear();
  }
  function applyPose(el, pose) {
    el.setAttribute('position', { x: pose.x, y: pose.y, z: pose.z });
    el.setAttribute('rotation', { x: 0, y: pose.yaw, z: 0 });
  }
  function createModel(root, name) {
    const entry = models[name];
    const config = typeof entry === 'string' ? { src: entry } : entry;
    if (!config || typeof config.src !== 'string') throw new Error('モデルの src を指定してください：' + name);
    const model = document.createElement('a-entity');
    model.classList.add('avatar-model');
    model.setAttribute('position', config.position || '0 0 0');
    model.setAttribute('scale', config.scale || options.avatarScale || '1 1 1');
    model.setAttribute('rotation', { x: 0, y: config.yawOffset ?? options.avatarDirectionOffset ?? 0, z: 0 });
    model.addEventListener('model-error', function reportModelError() {
      if (!destroyed && root.isConnected && root.firstElementChild === model) {
        emit('model-error', { id: root.dataset.playerId, avatar: name, src: config.src });
      }
    });
    const walk = config.walk ?? options.walk ?? '';
    const idle = config.idle ?? options.idle ?? '';
    if (walk || idle) {
      const target = root === localAvatar ? player : root;
      model.setAttribute('avatar-motion', { target: '#' + CSS.escape(target.id), walk: walk, idle: idle });
    }
    // 遅れて完了した旧モデルのロードで、新しい選択を上書きしない。
    if (root.firstElementChild) root.firstElementChild.remove();
    root.appendChild(model);
    model.setAttribute('gltf-model', config.src);
  }
  function render(players) {
    if (destroyed) return;
    joined = players.some(function isSelf(player) { return player.id === socket.id; });
    const ids = new Set(players.map(function playerId(player) { return player.id; }));
    others.forEach(function removeMissing(el, id) {
      if (!ids.has(id)) { el.remove(); others.delete(id); emit('player-left', { id: id }); }
    });
    players.forEach(function renderPlayer(player) {
      if (player.id === socket.id) return; // 自分のモデルで視界をふさがない
      let root = others.get(player.id);
      const isNew = !root;
      if (!root) {
        root = document.createElement('a-entity');
        root.id = 'vr-remote-' + socket.id + '-' + player.id;
        root.classList.add('remote-avatar');
        root.dataset.playerId = player.id;
        scene.appendChild(root);
        others.set(player.id, root);
        if (AFRAME.components['vr-avatar-smooth']) root.setAttribute('vr-avatar-smooth', '');
      }
      if (root.dataset.avatar !== player.avatar) {
        const name = hasModel(player.avatar) ? player.avatar : selected;
        createModel(root, name);
        root.dataset.avatar = player.avatar;
      }
      applyPose(root, player);
      if (isNew) emit('player-joined', player);
    });
    count = players.length;
    emit('count', count);
  }
  function currentPose() {
    if (options.getPose) return options.getPose();
    player.object3D.updateWorldMatrix(true, false);
    player.object3D.getWorldPosition(worldPosition);
    player.object3D.getWorldQuaternion(worldRotation);
    angles.setFromQuaternion(worldRotation, 'YXZ');
    return {
      x: worldPosition.x,
      y: worldPosition.y - (options.eyeHeight ?? 1.6),
      z: worldPosition.z,
      yaw: THREE.MathUtils.radToDeg(angles.y)
    };
  }
  function join() {
    if (localAvatar) localAvatar.dataset.playerId = socket.id;
    if (!destroyed) socket.emit('vr:join', { room: roomName, avatar: selected, pose: currentPose() });
  }
  function receivePose(pose) {
    const el = others.get(pose.id);
    if (el) { applyPose(el, pose); emit('player-moved', pose); }
  }
  function disconnected() {
    if (localAvatar) delete localAvatar.dataset.playerId;
    joined = false;
    clear();
    count = 0;
    emit('count', 0);
  }
  function sendPose() {
    if (destroyed || !socket.connected || !joined || !scene.hasLoaded) return;
    // 古い位置を再接続後にまとめて再送しない。
    socket.volatile.emit('vr:pose', currentPose());
  }
  function begin() { if (!destroyed) socket.connect(); }
  function pageHidden() { socket.disconnect(); }
  function pageShown(event) {
    // 戻る操作でページが復元された場合も再参加する。
    if (event.persisted) begin();
  }
  function on(name, fn) {
    if (destroyed) throw new Error('destroy 後のライブラリは使えません');
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
    if (name === 'count') fn(count);
  }
  function setAvatar(name) {
    if (destroyed) throw new Error('destroy 後のライブラリは使えません');
    if (!hasModel(name)) throw new Error('未登録のアバター');
    selected = name;
    if (localAvatar) {
      createModel(localAvatar, name);
      localAvatar.dataset.avatar = name;
    }
    if (socket.connected) socket.emit('vr:avatar', name);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    scene.removeEventListener('loaded', begin);
    clearTimeout(beginTimer);
    clearInterval(timer);
    window.removeEventListener('pagehide', pageHidden);
    window.removeEventListener('pageshow', pageShown);
    socket.off('disconnect', disconnected);
    socket.disconnect();
    disconnected();
    socket.off('connect', join);
    socket.off('vr:state', render);
    socket.off('vr:pose', receivePose);
    listeners.clear();
    if (localAvatar) localAvatar.replaceChildren();
  }
  socket.on('connect', join);
  socket.on('vr:state', render);
  socket.on('vr:pose', receivePose);
  socket.on('disconnect', disconnected);
  window.addEventListener('pagehide', pageHidden);
  window.addEventListener('pageshow', pageShown);
  const timer = setInterval(sendPose, 100);
  if (localAvatar) {
    createModel(localAvatar, selected);
    localAvatar.dataset.avatar = selected;
  }
  if (scene.hasLoaded) beginTimer = setTimeout(begin, 0);
  else scene.addEventListener('loaded', begin, { once: true });
  return { socket: socket, on: on, setAvatar: setAvatar, destroy: destroy };
}

/* 移動に応じた再生と、指定したクリップの再生。追加の補助JSは不要。 */
AFRAME.registerComponent('avatar-motion', {
  after: ['vr-solid-controls'],
  schema: {
    target: { type: 'selector' },
    walk: { type: 'string', default: '' },
    idle: { type: 'string', default: '' },
    clip: { type: 'string', default: '' },
    loop: { type: 'string', default: 'repeat' },
    clampWhenFinished: { type: 'boolean', default: false },
    paused: { type: 'boolean', default: false }
  },
  init: function init() {
    this.previous = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.lastMoved = -Infinity;
    this.lastState = null;
    this.actions = {};
    this.loopMode = 'repeat';
    this.animationFinished = this.animationFinished.bind(this);
    this.readPosition();
    this.previous.copy(this.position);
    this.modelLoaded = this.modelLoaded.bind(this);
    this.el.addEventListener('model-loaded', this.modelLoaded);
    if (this.el.getObject3D('mesh')) this.modelLoaded();
  },
  readPosition: function readPosition() {
    const target = this.data.target;
    if (!target) return;
    target.object3D.updateWorldMatrix(true, false);
    target.object3D.getWorldPosition(this.position);
  },
  update: function update(previous) {
    if (!this.mesh || (previous.walk === undefined && previous.idle === undefined)) return;
    const manual = !!this.data.clip;
    if (previous.clip !== this.data.clip || previous.loop !== this.data.loop || previous.clampWhenFinished !== this.data.clampWhenFinished ||
        (!manual && (previous.walk !== this.data.walk || previous.idle !== this.data.idle))) this.configure();
    if (previous.target !== this.data.target) {
      this.readPosition();
      this.previous.copy(this.position);
      this.lastMoved = -Infinity;
    }
    // pausedだけの変更では再生位置を巻き戻さない。
  },
  modelLoaded: function modelLoaded() {
    this.release();
    this.mesh = this.el.getObject3D('mesh');
    this.readPosition();
    this.previous.copy(this.position);
    this.lastMoved = -Infinity;
    this.lastState = 'idle';
    this.configure();
  },
  configure: function configure() {
    clearTimeout(this.warningTimer);
    const state = this.data.clip ? 'clip' : (this.lastState === 'clip' ? 'idle' : this.lastState || 'idle');
    this.release();
    const clips = this.mesh.animations || [];
    const data = this.data;
    function findClip(name) {
      if (!name) return null;
      const exact = clips.find(function exactName(clip) { return clip.name === name; });
      if (exact) return exact;
      const matches = clips.filter(function shortName(clip) { return clip.name.split('|').pop() === name; });
      return matches.length === 1 ? matches[0] : null;
    }
    const walk = data.clip ? null : findClip(data.walk), idle = data.clip ? null : findClip(data.idle), clip = findClip(data.clip);
    const missing = (data.clip ? [!clip ? data.clip : ''] : [data.walk && !walk ? data.walk : '', data.idle && !idle ? data.idle : '']).filter(Boolean);
    if (missing.length && !this.el.closest('.remote-avatar')) {
      const key = JSON.stringify([this.mesh.uuid, data.walk, data.idle, data.clip]);
      // 切り替えと同時に変更した旧モデルの設定は案内しない。
      this.warningTimer = setTimeout(function warnMissingClip() {
        if (this.el.getObject3D('mesh') !== this.mesh || this.lastClipWarning === key) return;
        this.lastClipWarning = key;
        console.warn('[vr-kit] ' + this.el.getAttribute('gltf-model') + ' のアニメーション「' + missing.join('」「') + '」を特定できません。Consoleの一覧にある完全な名前をwalk / idle / clipへ指定してください。');
      }.bind(this), 0);
    } else this.lastClipWarning = '';
    if (data.loop === 'repeat' || data.loop === 'once') this.loopMode = data.loop;
    else console.warn('[vr-kit] avatar-motionのloopはrepeatまたはonceを指定してください。直前の有効な設定を使います。');
    if (walk || idle || clip) {
      this.mixer = new THREE.AnimationMixer(this.mesh);
      this.mixer.addEventListener('finished', this.animationFinished);
      if (walk) this.actions.walk = this.mixer.clipAction(walk);
      if (idle) this.actions.idle = this.mixer.clipAction(idle);
      if (clip) this.actions.clip = this.mixer.clipAction(clip);
      for (const action of Object.values(this.actions)) {
        action.setLoop(this.loopMode === 'once' ? THREE.LoopOnce : THREE.LoopRepeat, this.loopMode === 'once' ? 1 : Infinity);
        action.clampWhenFinished = data.clampWhenFinished;
      }
    }
    this.readPosition();
    this.previous.copy(this.position);
    this.lastMoved = -Infinity;
    this.lastState = null;
    this.playState(state);
    // paused=trueでも最初のフレームを反映できる。宝箱は閉じた姿勢から待機する。
    if (this.mixer) this.mixer.update(0);
    this.el.emit('vr-animation-info', {
      clips: clips.map(function clipName(clip) { return clip.name; }),
      walk: walk ? walk.name : '',
      idle: idle ? idle.name : '',
      clip: clip ? clip.name : '',
      requestedWalk: data.walk,
      requestedIdle: data.idle,
      requestedClip: data.clip,
      loop: this.loopMode,
      clampWhenFinished: data.clampWhenFinished,
      missing: missing
    }, true);
  },
  playState: function playState(state) {
    if (state === this.lastState) return;
    this.lastState = state;
    if (this.mixer) this.mixer.stopAllAction();
    const action = this.actions[state];
    if (action) action.reset().play();
    this.el.dataset.motion = action ? state : 'none';
    this.el.dataset.animationClip = action ? action.getClip().name : '';
    this.el.dataset.animationFinished = 'false';
  },
  animationFinished: function animationFinished(event) {
    if (event.action !== this.actions[this.lastState] || this.el.dataset.animationFinished === 'true') return;
    // Mixerが最後の姿勢を反映した後、tickの末尾で終了を通知する。
    this.pendingFinished = event.action;
  },
  reportFinished: function reportFinished() {
    const action = this.pendingFinished;
    this.pendingFinished = null;
    if (!action) return;
    this.el.dataset.animationFinished = 'true';
    this.el.emit('vr-animation-finished', { clip: action.getClip().name, state: this.lastState, clamped: action.clampWhenFinished }, true);
  },
  tick: function tick(time, delta) {
    if (!delta) return;
    const seconds = Math.min(delta / 1000, 0.25);
    if (this.data.clip) {
      this.playState('clip');
      if (this.mixer && !this.data.paused) this.mixer.update(seconds);
      this.reportFinished();
      return;
    }
    if (!this.data.target) {
      if (this.mixer && !this.data.paused) this.mixer.update(seconds);
      this.reportFinished();
      return;
    }
    this.readPosition();
    const moving = this.position.distanceTo(this.previous) / seconds > 0.05;
    this.previous.copy(this.position);
    const controls = this.data.target.components['wasd-controls'];
    if (controls) {
      // 本人はキーを離したら、慣性が残っていてもRunを途中で止める。
      const keys = controls.keys;
      const input = controls.data.enabled && controls.data.acceleration > 0 && (
        (controls.data.adEnabled && (!!(keys.KeyA || keys.ArrowLeft) !== !!(keys.KeyD || keys.ArrowRight))) ||
        (controls.data.wsEnabled && (!!(keys.KeyW || keys.ArrowUp) !== !!(keys.KeyS || keys.ArrowDown)))
      );
      const collision = this.data.target.components['vr-solid-controls'];
      // 障害物に向かって操作している間は歩行を維持する。設定でIdleにもできる。
      const pushing = collision?.blocked && !collision.data.idleWhenBlocked;
      this.playState(input && (moving || pushing) ? 'walk' : 'idle');
    } else {
      if (moving) this.lastMoved = time;
      // 相手の位置は100ms間隔で届くため、歩行と停止の細かい往復を防ぐ。
      this.playState(time - this.lastMoved < 180 ? 'walk' : 'idle');
    }
    if (this.mixer && !this.data.paused) this.mixer.update(seconds);
    this.reportFinished();
  },
  release: function release() {
    this.pendingFinished = null;
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this.animationFinished);
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mesh);
    }
    this.mixer = null;
    this.actions = {};
  },
  remove: function remove() {
    clearTimeout(this.warningTimer);
    this.el.removeEventListener('model-loaded', this.modelLoaded);
    this.release();
  }
});

/* 固いアイテム。半径は見た目のscaleに連動しない、ワールド座標でのm。 */
const vrSolidItems = new WeakMap();
const vrMovementAreas = new WeakMap();
const vrWalkableSurfaces = new WeakMap();

/* 地面として調べる面。モデル全体でも、床と坂だけの要素でも使える。 */
AFRAME.registerComponent('walkable', {
  schema: {
    enabled: { type: 'boolean', default: true },
    autoAlign: { type: 'boolean', default: true }
  },
  init: function init() {
    this.surfaces = vrWalkableSurfaces.get(this.el.sceneEl);
    if (!this.surfaces) {
      this.surfaces = new Set();
      vrWalkableSurfaces.set(this.el.sceneEl, this.surfaces);
    }
    this.surfaces.add(this);
  },
  remove: function remove() { this.surfaces.delete(this); }
});

/* 指定した地形を高さ0とし、positionのYを地面からの高さ（m）として使う。 */
AFRAME.registerComponent('ground', {
  // 文字列で保持するので、地形要素を後から追加した場合も見つけられる。
  schema: { type: 'string', default: '' },
  after: ['vr-solid-controls'],
  init: function init() {
    this.point = new THREE.Vector3();
    this.revision = 0;
    this.invalidate = () => { this.revision++; };
    this.modelChanged = () => { this.restoreMesh(); this.hideMesh(); this.invalidate(); };
    this.el.addEventListener('object3dset', this.modelChanged);
    this.hideMesh();
  },
  update: function update() { this.key = null; },
  play: function play() {
    // A-FrameはDOMの親を変えるとremove後に同じインスタンスを再利用する。
    this.el.addEventListener('object3dset', this.modelChanged);
    this.key = null;
  },
  mountAnchor: function mountAnchor() {
    const object = this.el.object3D;
    if (this.anchor && object.parent === this.anchor) return this.anchor.parent;
    this.anchor?.parent?.remove(this.anchor);
    const parent = object.parent;
    if (!parent) return null;
    // positionを接地後の値で書き換えない。外側のグループだけで地面の高さを補う。
    this.anchor = new THREE.Group();
    this.anchor.name = 'vr-ground-anchor';
    parent.add(this.anchor);
    this.anchor.add(object);
    this.key = null;
    return parent;
  },
  unmountAnchor: function unmountAnchor(preservePosition) {
    const object = this.el.object3D, parent = this.anchor?.parent;
    if (parent && object.parent === this.anchor) {
      if (preservePosition) object.getWorldPosition(this.point);
      parent.add(object);
      if (preservePosition) {
        parent.worldToLocal(this.point);
        this.el.setAttribute('position', { x: this.point.x, y: this.point.y, z: this.point.z });
      }
    }
    parent?.remove(this.anchor);
    this.anchor = null;
  },
  hideMesh: function hideMesh() {
    this.ready = false;
    const mesh = this.el.getObject3D('mesh');
    if (!mesh || this.hiddenMesh === mesh) return;
    this.hiddenMesh = mesh;
    this.meshVisible = mesh.visible;
    mesh.visible = false;
  },
  restoreMesh: function restoreMesh() {
    if (this.hiddenMesh) this.hiddenMesh.visible = this.meshVisible;
    this.hiddenMesh = null;
  },
  setSurface: function setSurface(surface) {
    for (const event of ['object3dset', 'object3dremove', 'model-loaded', 'componentchanged']) {
      this.surface?.removeEventListener(event, this.invalidate, true);
      surface?.addEventListener(event, this.invalidate, true);
    }
    this.surface = surface;
    this.key = null;
  },
  tick: function tick(time = performance.now()) {
    const scene = this.el.sceneEl;
    // 操作キャラには既存のwalkable処理がある。モデルだけを動かしてリグとずらさない。
    if (this.el.hasAttribute('avatar')) {
      this.unmountAnchor(true); this.restoreMesh(); this.ready = true; return;
    }
    let surface = null;
    try { if (this.data) surface = scene.querySelector(this.data); } catch (_) { /* 無効な指定も待機扱い。 */ }
    if (surface !== this.surface) this.setSurface(surface);
    if (!surface?.isConnected || !surface.object3D || surface === this.el ||
        surface.contains(this.el) || this.el.contains(surface)) {
      this.hideMesh(); return;
    }
    // avatarの初期化前には配置しない。tickの順序でwalkableの高さ合わせを先に済ませる。
    const avatar = scene.querySelector('[avatar]');
    if (avatar && !avatar.components.avatar?.controls) {
      this.hideMesh(); return;
    }
    const parent = this.mountAnchor();
    if (!parent) { this.hideMesh(); return; }
    surface.object3D.updateWorldMatrix(true, false);
    parent.updateWorldMatrix(true, false);
    const position = this.el.object3D.position;
    // X/Zは親からの配置、Yだけはワールドの地面からのm。親やモデルのscaleに連動しない。
    this.point.set(position.x, 0, position.z).applyMatrix4(parent.matrixWorld);
    const keyFor = () => this.revision + '|' + surface.object3D.matrixWorld.elements.join(',') +
      '|' + parent.matrixWorld.elements.join(',') + '|' + [position.x, position.y, position.z].join(',');
    const key = keyFor();
    // visibleなど通知されない変更も拾う。静止中の全メッシュ判定は毎フレーム行わない。
    if (key === this.key && time - this.checkedAt < 250) return;
    this.checkedAt = time;
    const y = getGroundHeight(surface, this.point.x, this.point.z);
    if (y === null) { this.key = key; this.hideMesh(); return; }
    this.point.y = y + position.y;
    parent.worldToLocal(this.point);
    this.anchor.position.copy(this.point).sub(position);
    this.key = keyFor();
    // elementのvisibleは変更しない。取得済み・作者が非表示にしたモデルは再表示しない。
    this.restoreMesh();
    this.ready = true;
  },
  remove: function remove() {
    this.setSurface(null);
    this.el.removeEventListener('object3dset', this.modelChanged);
    // ground属性だけを外したときは見た目の位置を保つ。DOMの移動では相対Yを保つ。
    let attached = this.el.isConnected;
    for (let el = this.el; el && !el.isScene; el = el.parentEl) {
      if (el.parentNode !== el.parentEl) { attached = false; break; }
    }
    this.unmountAnchor(attached);
    this.restoreMesh();
    this.ready = false;
  }
});

/* 足元近くの面だけを探す。重力・ジャンプ・足ごとのIKは行わない。 */
AFRAME.registerComponent('vr-ground-controls', {
  schema: {
    stepHeight: { type: 'number', default: 0.25 },
    maxSlope: { type: 'number', default: 45 },
    groundOffset: { type: 'number', default: 0 }
  },
  init: function init() {
    this.ray = new THREE.Raycaster();
    this.down = new THREE.Vector3(0, -1, 0);
    this.origin = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.normalMatrix = new THREE.Matrix3();
    this.safe = new THREE.Vector3();
    this.candidate = new THREE.Vector3();
    this.meshes = [];
    this.hits = [];
    this.anchor = this.el.object3D.getWorldPosition(new THREE.Vector3());
    this.bounds = new THREE.Box3();
    this.meshBounds = new THREE.Box3();
    this.alignmentPosition = new THREE.Vector3();
    this.surfaceMeshes = new Map();
    this.settings = { stepHeight: 0.25, maxSlope: 45, groundOffset: 0 };
  },
  update: function update() {
    for (const name of ['stepHeight', 'maxSlope', 'groundOffset']) {
      const value = this.data[name];
      const valid = Number.isFinite(value) && (name === 'groundOffset' || value >= 0) && (name !== 'maxSlope' || value < 90);
      if (valid) this.settings[name] = value;
      else console.warn('[vr-kit] ' + name + 'を確認してください。stepHeightは0以上のm、maxSlopeは0以上90未満の度、groundOffsetは有限のmです。直前の有効な値を使います。');
    }
    this.minimumNormalY = Math.cos(THREE.MathUtils.degToRad(this.settings.maxSlope));
  },
  collect: function collect() {
    this.meshes.length = 0;
    this.surfaceMeshes.clear();
    const seen = new Set();
    let active = false;
    for (const surface of vrWalkableSurfaces.get(this.el.sceneEl) || []) {
      if (!surface.data.enabled || !surface.el.isConnected) continue;
      let visible = true;
      for (let object = surface.el.object3D; object; object = object.parent) {
        if (!object.visible || object === this.el.object3D) visible = false;
      }
      if (!visible) continue;
      active = true;
      surface.el.object3D.updateWorldMatrix(true, true);
      const meshes = [];
      surface.el.object3D.traverse(object => {
        if (!object.isMesh || object.isSkinnedMesh) return;
        for (let parent = object; parent; parent = parent.parent) {
          if (!parent.visible || parent === this.el.object3D) return;
        }
        meshes.push(object);
        if (!seen.has(object)) { seen.add(object); this.meshes.push(object); }
      });
      this.surfaceMeshes.set(surface, meshes);
    }
    return active;
  },
  alignGround: function alignGround() {
    if (this.alignedSurface && (!this.surfaceMeshes.has(this.alignedSurface) || !this.alignedSurface.data.autoAlign)) {
      this.alignedSurface = null;
      this.alignmentKey = null;
    }
    for (const [surface, meshes] of this.surfaceMeshes) {
      if (!surface.data.autoAlign || !meshes.length || (this.alignedSurface && surface !== this.alignedSurface)) continue;
      const object = surface.el.object3D;
      // 自分で行った高さ補正後の値を記録するので、歩行中は地形を動かさない。
      const signature = () => object.matrixWorld.elements.join(',') + '|' + meshes.map(mesh => mesh.uuid + ':' + mesh.geometry.uuid + ':' + mesh.matrixWorld.elements.join(',')).join('|');
      const key = signature();
      if (surface === this.alignedSurface && key === this.alignmentKey) return;
      this.bounds.makeEmpty();
      for (const mesh of meshes) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) this.bounds.union(this.meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
      }
      if (this.bounds.isEmpty() || ![this.bounds.min.y, this.bounds.max.y].every(Number.isFinite)) continue;
      // 初回だけモデル全体の高さから探す。通常歩行のstepHeightとは分ける。
      this.origin.set(this.anchor.x, this.bounds.max.y + 0.01, this.anchor.z);
      this.ray.set(this.origin, this.down);
      this.ray.near = 0;
      this.ray.far = this.bounds.max.y - this.bounds.min.y + 0.02;
      this.hits.length = 0;
      this.ray.intersectObjects(meshes, false, this.hits);
      let floor = null, nearest = Infinity;
      const targetY = this.anchor.y - this.settings.groundOffset;
      for (const hit of this.hits) {
        if (this.worldNormal(hit).y + 1e-7 < this.minimumNormalY) continue;
        const distance = Math.abs(hit.point.y - targetY);
        if (distance < nearest) { nearest = distance; floor = hit.point.y; }
      }
      // X/Zに地面がない、または急斜面しかないときは、地形を勝手に移動しない。
      if (floor === null) continue;
      object.getWorldPosition(this.alignmentPosition);
      this.alignmentPosition.y += targetY - floor;
      if (object.parent) object.parent.worldToLocal(this.alignmentPosition);
      surface.el.setAttribute('position', { x: this.alignmentPosition.x, y: this.alignmentPosition.y, z: this.alignmentPosition.z });
      object.updateWorldMatrix(true, true);
      this.alignedSurface = surface;
      this.alignmentKey = signature();
      return;
    }
  },
  intersections: function intersections(origin, direction, far) {
    this.hits.length = 0;
    this.ray.set(origin, direction);
    this.ray.near = 0;
    this.ray.far = far;
    return this.ray.intersectObjects(this.meshes, false, this.hits);
  },
  worldNormal: function worldNormal(hit) {
    this.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    return this.normal.copy(hit.face.normal).applyMatrix3(this.normalMatrix).normalize();
  },
  floorHeight: function floorHeight(x, y, z) {
    const step = this.settings.stepHeight, offset = this.settings.groundOffset;
    this.origin.set(x, y - offset + step + 0.001, z);
    const hit = this.intersections(this.origin, this.down, step * 2 + 0.002)[0];
    if (!hit || this.worldNormal(hit).y + 1e-7 < this.minimumNormalY) return null;
    return hit.point.y + offset;
  },
  tryStep: function tryStep(from, to) {
    // 高い段差の内部に入り、下にある床を拾ってすり抜けるのを防ぐ。
    this.origin.set(from.x, from.y - this.settings.groundOffset + this.settings.stepHeight + 0.001, from.z);
    this.direction.set(to.x - from.x, 0, to.z - from.z);
    const distance = this.direction.length();
    if (distance > 1e-8) {
      this.direction.divideScalar(distance);
      const hit = this.intersections(this.origin, this.direction, distance)[0];
      if (hit && this.worldNormal(hit).y + 1e-7 < this.minimumNormalY && this.normal.dot(this.direction) < -1e-7) return false;
    }
    const height = this.floorHeight(to.x, from.y, to.z);
    if (height === null) return false;
    to.y = height;
    return true;
  },
  resolve: function resolve(from, to) {
    if (!this.collect()) { this.warnedStart = false; return false; }
    this.alignGround();
    this.safe.copy(from);
    const height = this.floorHeight(from.x, from.y, from.z);
    if (height === null) {
      if (!this.warnedStart) {
        console.warn('[vr-kit] walkableの地面を足元に見つけられません。モデルの読み込み、開始位置の高さ、stepHeight、maxSlopeを確認してください。地面が見つかるまで移動を止めます。');
        this.warnedStart = true;
      }
      to.copy(from);
      return true;
    }
    this.warnedStart = false;
    this.safe.y = height;
    const dx = to.x - from.x, dz = to.z - from.z;
    if (dx * dx + dz * dz < 1e-16) { to.copy(this.safe); return false; }
    // 8cmごとに調べ、高速移動でも途中の段差や地面の切れ目を確認する。
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
    let blocked = count > 128;
    for (let i = 1; i <= Math.min(count, 128); i++) {
      this.candidate.set(from.x + dx * i / count, this.safe.y, from.z + dz * i / count);
      if (!this.tryStep(this.safe, this.candidate)) {
        // 最後の8cmを細かく探し、端の手前まで進める。
        const badX = this.candidate.x, badZ = this.candidate.z;
        const safeX = this.safe.x, safeZ = this.safe.z;
        let low = 0, high = 1;
        for (let refine = 0; refine < 6; refine++) {
          const middle = (low + high) / 2;
          this.candidate.set(safeX + (badX - safeX) * middle, this.safe.y, safeZ + (badZ - safeZ) * middle);
          if (this.tryStep(this.safe, this.candidate)) { low = middle; this.safe.copy(this.candidate); }
          else high = middle;
        }
        blocked = true;
        break;
      }
      this.safe.copy(this.candidate);
    }
    to.copy(this.safe);
    return blocked;
  }
});

AFRAME.registerComponent('solid', {
  schema: {
    radius: { type: 'number', default: 0.7 },
    enabled: { type: 'boolean', default: true }
  },
  init: function init() {
    this.radius = 0.7;
    this.items = vrSolidItems.get(this.el.sceneEl);
    if (!this.items) {
      this.items = new Set();
      vrSolidItems.set(this.el.sceneEl, this.items);
    }
    this.items.add(this);
  },
  update: function update() {
    if (Number.isFinite(this.data.radius) && this.data.radius >= 0) this.radius = this.data.radius;
    else console.warn('[vr-kit] solidのradiusは0以上の半径（m）で指定してください。直前の有効な値を使います。');
  },
  remove: function remove() { this.items.delete(this); }
});

/* 水平な平面を、本人が出られない範囲にする。重力や高さの補正は行わない。 */
AFRAME.registerComponent('movement-area', {
  schema: { enabled: { type: 'boolean', default: true } },
  init: function init() {
    this.areas = vrMovementAreas.get(this.el.sceneEl);
    if (!this.areas) {
      this.areas = new Set();
      vrMovementAreas.set(this.el.sceneEl, this.areas);
    }
    this.areas.add(this);
  },
  warn: function warn(message) {
    if (this.lastWarning !== message) console.warn('[vr-kit] movement-area: ' + message);
    this.lastWarning = message;
    return null;
  },
  getBounds: function getBounds(radius) {
    const geometry = this.el.components.geometry?.data;
    if (geometry?.primitive !== 'plane') return this.warn('水平なa-planeに付けてください。');
    this.el.object3D.updateWorldMatrix(true, false);
    const e = this.el.object3D.matrixWorld.elements;
    const uLength = Math.hypot(e[0], e[1], e[2]), vLength = Math.hypot(e[4], e[5], e[6]);
    const determinant = e[0] * e[6] - e[2] * e[4];
    if (!uLength || !vLength || Math.abs(e[1]) > uLength * 1e-5 || Math.abs(e[5]) > vLength * 1e-5 || !determinant) {
      return this.warn('地面は水平にしてください。通常はrotation="-90 0 0"を使い、scaleを0にしません。');
    }
    // 平面のローカルX/Yを床のXZへ写す。親の回転・拡大・変形も含める。
    const ux = e[6] / determinant, uz = -e[4] / determinant;
    const vx = -e[2] / determinant, vz = e[0] / determinant;
    const u = Math.hypot(ux, uz), v = Math.hypot(vx, vz);
    const halfU = geometry.width / (2 * u) - radius;
    const halfV = geometry.height / (2 * v) - radius;
    if (![halfU, halfV, e[12], e[14]].every(Number.isFinite) || halfU < 0 || halfV < 0) {
      return this.warn('幅・高さ・scaleを確認し、プレイヤーの半径を含めて収まる大きさにしてください。');
    }
    const x = e[12], z = e[14];
    function edge(nx, nz, half) { return { nx: nx, nz: nz, offset: nx * x + nz * z - half }; }
    this.lastWarning = '';
    return [edge(ux / u, uz / u, halfU), edge(-ux / u, -uz / u, halfU),
      edge(vx / v, vz / v, halfV), edge(-vx / v, -vz / v, halfV)];
  },
  remove: function remove() { this.areas.delete(this); }
});

/* 操作による移動後、障害物の円と移動範囲の辺で進路を調整する。 */
AFRAME.registerComponent('vr-solid-controls', {
  dependencies: ['wasd-controls'],
  after: ['wasd-controls'],
  schema: {
    radius: { type: 'number', default: 0.35 },
    idleWhenBlocked: { type: 'boolean', default: false }
  },
  init: function init() {
    this.start = new THREE.Vector3();
    this.end = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.blocked = false;
    this.captured = false;
  },
  capture: function capture() {
    this.el.object3D.getWorldPosition(this.start);
    this.captured = true;
    this.blocked = false;
  },
  tick: function tick() {
    if (!this.captured) return;
    this.captured = false;
    this.el.object3D.getWorldPosition(this.end);
    let x = this.start.x, z = this.start.z;
    let dx = this.end.x - x, dz = this.end.z - z;
    if (dx * dx + dz * dz < 1e-16) {
      const ground = this.el.components['vr-ground-controls'];
      if (!ground) return;
      ground.resolve(this.start, this.end);
      if (this.el.object3D.parent) this.el.object3D.parent.worldToLocal(this.end);
      this.el.object3D.position.copy(this.end);
      return;
    }
    const obstacles = [];
    const items = vrSolidItems.get(this.el.sceneEl);
    for (const item of items || []) {
      if (!item.data.enabled || !item.el.isConnected) continue;
      // 接地待ちで非表示のNPCが、見えない障害物になるのを防ぐ。
      if (item.el.components.ground?.ready === false) continue;
      const object = item.el.object3D;
      let visible = true, own = false;
      for (let parent = object; parent; parent = parent.parent) {
        if (!parent.visible) visible = false;
        if (parent === this.el.object3D) own = true;
      }
      for (let parent = this.el.object3D; parent; parent = parent.parent) {
        if (parent === object) own = true;
      }
      if (!visible || own) continue;
      object.getWorldPosition(this.center);
      if (!Number.isFinite(this.center.x) || !Number.isFinite(this.center.z)) continue;
      obstacles.push({ x: this.center.x, z: this.center.z, radius: item.radius + this.data.radius + 0.0001 });
    }
    let bounds = null;
    for (const area of vrMovementAreas.get(this.el.sceneEl) || []) {
      if (!area.data.enabled || !area.el.isConnected) continue;
      let visible = true;
      for (let object = area.el.object3D; object; object = object.parent) {
        if (!object.visible) visible = false;
      }
      if (!visible) continue;
      if (bounds) { area.warn('有効な移動範囲は1枚で使ってください。最初の有効な平面を使います。'); continue; }
      bounds = area.getBounds(this.data.radius + 0.0001);
    }
    // 線分と円の最初の接点を探すので、高速移動でも向こう側へ抜けない。
    // 接点からは内向きの移動だけ除き、斜め入力なら外周に沿って動ける。
    const normals = [];
    for (let attempt = 0; attempt < 6 && dx * dx + dz * dz > 1e-16; attempt++) {
      let hit = null, fraction = 1;
      const lengthSquared = dx * dx + dz * dz;
      for (const obstacle of obstacles) {
        const ox = x - obstacle.x, oz = z - obstacle.z;
        const approach = ox * dx + oz * dz;
        if (approach >= 0) continue; // 最初から重なっていても、外へは出られる。
        const outside = ox * ox + oz * oz - obstacle.radius * obstacle.radius;
        const discriminant = approach * approach - lengthSquared * outside;
        if (discriminant < 0) continue;
        const contact = outside < 0 ? 0 : (-approach - Math.sqrt(discriminant)) / lengthSquared;
        if (contact < 0 || contact > fraction) continue;
        fraction = contact;
        hit = obstacle;
      }
      for (const edge of bounds || []) {
        const approach = dx * edge.nx + dz * edge.nz;
        if (approach >= 0) continue;
        const inside = x * edge.nx + z * edge.nz - edge.offset;
        const contact = Math.max(0, inside) / -approach;
        if (contact > fraction) continue;
        fraction = contact;
        hit = edge;
      }
      if (!hit) { x += dx; z += dz; break; }
      x += dx * fraction;
      z += dz * fraction;
      const nx = hit.nx === undefined ? x - hit.x : hit.nx;
      const nz = hit.nz === undefined ? z - hit.z : hit.nz;
      const distance = Math.hypot(nx, nz);
      // 異なる向きの2面に当たったら、このフレームは接点で止める。
      // 狭い隙間で滑りを繰り返し、横や後方へ押し出されるのを防ぐ。
      if (normals.some(function differentSurface(normal) { return Math.abs(nx * normal.z - nz * normal.x) / distance > 1e-5; })) break;
      dx *= 1 - fraction;
      dz *= 1 - fraction;
      const inward = (dx * nx + dz * nz) / (distance * distance);
      if (inward < 0) { dx -= nx * inward; dz -= nz * inward; }
      normals.push({ x: nx / distance, z: nz / distance });
    }
    const intendedX = this.end.x, intendedZ = this.end.z;
    const solidBlocked = Math.hypot(intendedX - x, intendedZ - z) > 1e-7;
    this.end.x = x;
    this.end.z = z;
    const groundBlocked = this.el.components['vr-ground-controls']?.resolve(this.start, this.end);
    // 障害物に沿った経路と地面の端が同時に干渉したら、安全な開始点で止める。
    // 曲がった経路の途中を直線補間して、障害物の内側へ入るのを避ける。
    if (solidBlocked && groundBlocked) {
      this.end.copy(this.start);
      this.el.components['vr-ground-controls'].resolve(this.start, this.end);
    }
    this.blocked = !!groundBlocked || Math.hypot(intendedX - this.end.x, intendedZ - this.end.z) > 1e-7;
    if (!this.blocked && Math.abs(this.end.y - this.start.y) < 1e-10) return;
    // リグの親が変換されていても、ワールド座標で止めてからローカルへ戻す。
    if (this.el.object3D.parent) this.el.object3D.parent.worldToLocal(this.end);
    this.el.object3D.position.copy(this.end);
  }
});

/* 本人の操作だけ、入力を離した方向の慣性を止める。 */
AFRAME.registerComponent('vr-stop-controls', {
  dependencies: ['wasd-controls'],
  before: ['wasd-controls'],
  schema: { turnSpeed: { type: 'number', default: 0 } },
  tick: function tick(time, delta) {
    this.el.components['vr-solid-controls']?.capture();
    const controls = this.el.components['wasd-controls'];
    const data = controls.data, keys = controls.keys;
    const left = !!(keys.KeyA || keys.ArrowLeft);
    const right = !!(keys.KeyD || keys.ArrowRight);
    const forward = !!(keys.KeyW || keys.ArrowUp);
    const backward = !!(keys.KeyS || keys.ArrowDown);
    if (data.enabled && this.data.turnSpeed && delta) {
      const rotation = this.el.getAttribute('rotation');
      const turn = (Number(left) - Number(right)) * this.data.turnSpeed * Math.min(delta / 1000, 0.1);
      if (turn) this.el.setAttribute('rotation', { x: 0, y: rotation.y + turn, z: 0 });
    }
    // 移動を計算する前に速度を0にする。反対方向の同時押しも停止する。
    if (!data.enabled || !data.adEnabled || left === right) controls.velocity[data.adAxis] = 0;
    if (!data.enabled || !data.wsEnabled || forward === backward) controls.velocity[data.wsAxis] = 0;
  }
});

/* 自動運転版：HTMLの属性から接続・表示・選択まで準備する。 */
(function registerAutomaticVR() {
  let nextId = 0;

  // 足元を動かす共通の操作。カメラだけを一人称・三人称で切り替える。
  function setupThirdPerson(scene, camera, data, uniqueId, existingAvatar = null) {
    const original = {
      parent: camera.parentNode, threeParent: camera.object3D.parent,
      position: { ...camera.getAttribute('position') }, rotation: { ...camera.getAttribute('rotation') },
      camera: { ...camera.getDOMAttribute('camera') },
      look: { ...camera.getAttribute('look-controls') }, wasd: { ...camera.getAttribute('wasd-controls') }
    };
    const position = new THREE.Vector3(), orientation = new THREE.Quaternion();
    const source = existingAvatar || camera;
    source.object3D.updateWorldMatrix(true, false);
    source.object3D.getWorldPosition(position);
    source.object3D.getWorldQuaternion(orientation);
    const originalAvatar = existingAvatar ? {
      parent: existingAvatar.object3D.parent,
      position: { ...existingAvatar.getAttribute('position') },
      rotation: { ...existingAvatar.getAttribute('rotation') },
      scale: { ...existingAvatar.getAttribute('scale') },
      hadLocalClass: existingAvatar.classList.contains('local-avatar')
    } : null;
    const facing = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(orientation, 'YXZ');
    const player = document.createElement('a-entity');
    player.id = 'vr-player-' + uniqueId;
    player.className = 'vr-player';
    const startPosition = { x: position.x, y: existingAvatar ? position.y : position.y - 1.6, z: position.z };
    const startRotation = { x: 0, y: THREE.MathUtils.radToDeg(facing.y), z: 0 };
    player.setAttribute('position', { ...startPosition });
    player.setAttribute('rotation', { ...startRotation });
    // 子要素の初期化前にも、初期位置と向きを3D側へ反映する。
    player.object3D.position.set(startPosition.x, startPosition.y, startPosition.z);
    player.object3D.rotation.set(0, facing.y, 0);
    player.setAttribute('wasd-controls', { acceleration: 30 });
    player.setAttribute('vr-stop-controls', '');
    if (existingAvatar) {
      player.setAttribute('vr-solid-controls', '');
      player.setAttribute('vr-ground-controls', '');
    }
    const local = existingAvatar || document.createElement('a-entity');
    if (!existingAvatar) {
      local.id = 'vr-local-avatar-' + uniqueId;
      player.appendChild(local);
    }
    local.classList.add('local-avatar');
    scene.appendChild(player);
    let controlsEnabled = data.enabled ?? true;
    let faceDirection = data.faceMovement ?? false;
    let turnSpeed = 120;
    if (existingAvatar) {
      player.object3D.attach(local.object3D);
      local.setAttribute('position', { x: 0, y: 0, z: 0 });
    }
    const baseAvatarRotation = local.object3D.quaternion.clone();
    const vertical = new THREE.Vector3(0, 1, 0);
    const headingRotation = new THREE.Quaternion();
    const modelRotation = new THREE.Quaternion();
    const posePosition = new THREE.Vector3();
    const poseRotation = new THREE.Quaternion();
    const poseAngles = new THREE.Euler(0, 0, 0, 'YXZ');
    let heading = 0;
    let avatarDirection = 0;
    function applyFacing() {
      headingRotation.setFromAxisAngle(vertical, heading);
      modelRotation.setFromAxisAngle(vertical, THREE.MathUtils.degToRad(avatarDirection));
      local.object3D.quaternion.copy(headingRotation).multiply(baseAvatarRotation).multiply(modelRotation);
      const rotation = new THREE.Euler(0, 0, 0, local.object3D.rotation.order).setFromQuaternion(local.object3D.quaternion, local.object3D.rotation.order);
      local.setAttribute('rotation', { x: THREE.MathUtils.radToDeg(rotation.x), y: THREE.MathUtils.radToDeg(rotation.y), z: THREE.MathUtils.radToDeg(rotation.z) });
    }
    function setAvatarDirection(degrees) {
      if (!Number.isFinite(degrees)) {
        console.warn('[vr-kit] avatarDirectionは角度を数値で指定してください。');
        return;
      }
      avatarDirection = degrees;
      applyFacing();
    }
    // カメラの向きやモデル固有の補正を含めず、本人の足元と進行方向を返す。
    function getPose() {
      player.object3D.updateWorldMatrix(true, false);
      player.object3D.getWorldPosition(posePosition);
      player.object3D.getWorldQuaternion(poseRotation);
      headingRotation.setFromAxisAngle(vertical, heading);
      poseRotation.multiply(headingRotation);
      poseAngles.setFromQuaternion(poseRotation, 'YXZ');
      return { x: posePosition.x, y: posePosition.y, z: posePosition.z, yaw: THREE.MathUtils.radToDeg(poseAngles.y) };
    }
    if (existingAvatar) setAvatarDirection(data.avatarDirection);
    camera.setAttribute('wasd-controls', 'enabled', false);
    camera.setAttribute('look-controls', 'enabled', false);
    // 三人称は近めの画角。HTMLで指定したfovがあれば優先する。
    if (original.camera.fov === undefined) camera.setAttribute('camera', 'fov', 60);
    // DOMの移動によるcameraコンポーネントの再初期化を避け、3D上の親だけを変える。
    player.object3D.add(camera.object3D);
    const offset = { ...data.cameraOffset };
    let lookHeight = data.lookHeight;
    camera.setAttribute('position', offset);
    const view = new THREE.PerspectiveCamera();
    view.position.set(offset.x, offset.y, offset.z);
    view.lookAt(0, lookHeight, 0);
    const rotation = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(view.quaternion, 'YXZ');
    camera.setAttribute('rotation', {
      x: THREE.MathUtils.radToDeg(rotation.x), y: THREE.MathUtils.radToDeg(rotation.y), z: THREE.MathUtils.radToDeg(rotation.z)
    });
    const baseCameraRotation = camera.object3D.quaternion.clone();
    const cameraHeading = new THREE.Quaternion();
    const firstPersonAngles = new THREE.Euler(0, 0, 0, 'YXZ');
    const localVisible = local.object3D.visible;
    let viewMode = 'third';
    let eyeHeight = data.eyeHeight ?? 1.6;
    let pitch = 0;
    let cameraFollow = !!data.cameraFollow;
    function updateCamera() {
      if (viewMode === 'first') {
        camera.object3D.position.set(0, eyeHeight, 0);
        firstPersonAngles.set(pitch, 0, 0);
        camera.object3D.quaternion.setFromEuler(firstPersonAngles);
        return;
      }
      // 体を基準にカメラを置く。旋回は共通のplayerで行う。
      // モデル固有のavatarDirectionはカメラに含めない。
      cameraHeading.setFromAxisAngle(vertical, cameraFollow ? heading : 0);
      camera.object3D.position.set(offset.x, offset.y, offset.z).applyQuaternion(cameraHeading);
      camera.object3D.quaternion.copy(cameraHeading).multiply(baseCameraRotation);
    }
    function setCameraFollow(enabled) {
      cameraFollow = enabled;
      setKeyboardMode();
      updateCamera();
    }
    function setKeyboardMode() {
      const turnWithKeys = viewMode === 'first' || cameraFollow;
      if (turnWithKeys) {
        // 体が向いている方向をWで進むための基準にする。
        const yaw = THREE.MathUtils.radToDeg(player.object3D.rotation.y + heading);
        player.setAttribute('rotation', { x: 0, y: yaw, z: 0 });
        heading = 0;
        applyFacing();
      }
      player.setAttribute('wasd-controls', 'adEnabled', !turnWithKeys);
      player.setAttribute('vr-stop-controls', 'turnSpeed', turnWithKeys ? turnSpeed : 0);
    }
    function setTurnSpeed(speed) {
      if (!Number.isFinite(speed) || speed < 0) {
        console.warn('[vr-kit] turnSpeedは0以上の数値（度/秒）で指定してください。');
        return;
      }
      turnSpeed = speed;
      setKeyboardMode();
    }
    function setMoveSpeed(speed) {
      if (!Number.isFinite(speed) || speed < 0) {
        console.warn('[vr-kit] moveSpeedは0以上の数値で指定してください。1が標準、2で2倍です。');
        return;
      }
      player.setAttribute('wasd-controls', 'acceleration', 30 * speed);
      player.components['wasd-controls']?.velocity?.set(0, 0, 0);
    }
    function setCollision(radius, idleWhenBlocked) {
      if (!existingAvatar) return;
      if (Number.isFinite(radius) && radius >= 0) player.setAttribute('vr-solid-controls', 'radius', radius);
      else console.warn('[vr-kit] collisionRadiusは0以上の半径（m）で指定してください。直前の有効な値を使います。');
      player.setAttribute('vr-solid-controls', 'idleWhenBlocked', idleWhenBlocked);
    }
    function setGround(stepHeight, maxSlope, groundOffset) {
      if (existingAvatar) player.setAttribute('vr-ground-controls', { stepHeight: stepHeight, maxSlope: maxSlope, groundOffset: groundOffset });
    }
    function setFaceMovement(enabled) { faceDirection = enabled; }
    function setView(nextView) {
      if (nextView !== 'first' && nextView !== 'third') return;
      if (nextView === 'first' && viewMode !== 'first') {
        pitch = 0;
      }
      viewMode = nextView;
      setKeyboardMode();
      local.object3D.visible = viewMode === 'first' ? false : localVisible;
      updateCamera();
    }
    function setEyeHeight(height) {
      if (!Number.isFinite(height) || height < 0) {
        console.warn('[vr-kit] eyeHeightは0以上の高さ（m）で指定してください。');
        return;
      }
      eyeHeight = height;
      updateCamera();
    }
    function setCameraSettings(nextOffset, nextHeight) {
      if (![nextOffset.x, nextOffset.y, nextOffset.z, nextHeight].every(Number.isFinite)) {
        console.warn('[vr-kit] cameraOffsetは3つの数値、lookHeightは高さの数値で指定してください。');
        return;
      }
      Object.assign(offset, nextOffset);
      lookHeight = nextHeight;
      view.position.set(offset.x, offset.y, offset.z);
      view.lookAt(0, lookHeight, 0);
      baseCameraRotation.copy(view.quaternion);
      updateCamera();
    }
    setView(data.view);
    const previousPosition = new THREE.Vector3();
    const currentPosition = new THREE.Vector3();
    const movement = new THREE.Vector3();
    const referenceRotation = new THREE.Quaternion();
    player.object3D.updateWorldMatrix(true, false);
    player.object3D.getWorldPosition(previousPosition);
    function faceMovement(delta) {
      if (!delta) return false;
      player.object3D.updateWorldMatrix(true, false);
      player.object3D.getWorldPosition(currentPosition);
      movement.subVectors(currentPosition, previousPosition);
      previousPosition.copy(currentPosition);
      const moving = movement.length() / (delta / 1000) > 0.05;
      // 一人称と追従する三人称はA/Dで旋回する。後退で体を反転させない。
      if (viewMode === 'first' || cameraFollow || !faceDirection) return moving;
      movement.y = 0;
      if (movement.length() / (delta / 1000) <= 0.05) return moving;
      // 移動の基準とカメラは回さず、体だけを実際の移動方向へ向ける。
      player.object3D.getWorldQuaternion(referenceRotation);
      movement.applyQuaternion(referenceRotation.invert());
      heading = Math.atan2(-movement.x, -movement.z);
      applyFacing();
      updateCamera();
      return moving;
    }
    const canvas = scene.canvas;
    let drag = null;
    function clearInput() {
      const wasd = player.components['wasd-controls'];
      if (wasd) { wasd.keys = {}; wasd.velocity?.set(0, 0, 0); }
      const collision = player.components['vr-solid-controls'];
      if (collision) collision.blocked = false;
      const avatar = local.components.avatar;
      if (avatar) avatar.moving = false;
      drag = null;
      const motion = local.components['avatar-motion'];
      if (motion) motion.playState('idle');
    }
    function setEnabled(enabled) {
      controlsEnabled = enabled;
      player.setAttribute('wasd-controls', 'enabled', enabled);
      clearInput();
    }
    function reset() {
      clearInput();
      player.setAttribute('position', { ...startPosition });
      player.setAttribute('rotation', { ...startRotation });
      heading = 0;
      pitch = 0;
      applyFacing();
      updateCamera();
      player.object3D.getWorldPosition(previousPosition);
    }
    function pointerDown(event) {
      if (!controlsEnabled || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, pitch: pitch, yaw: player.getAttribute('rotation').y, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      canvas.focus();
    }
    function pointerMove(event) {
      if (!controlsEnabled || !drag || drag.id !== event.pointerId) return;
      const previousYaw = player.getAttribute('rotation').y;
      const nextYaw = drag.yaw - (event.clientX - drag.x) * 0.2;
      player.setAttribute('rotation', { x: 0, y: nextYaw, z: 0 });
      if (viewMode === 'first') {
        pitch = THREE.MathUtils.clamp(drag.pitch - THREE.MathUtils.degToRad((event.clientY - drag.y) * 0.2), -Math.PI * 4 / 9, Math.PI * 4 / 9);
      } else if (faceDirection && !cameraFollow) {
        // ドラッグはカメラの基準だけを回し、停止中の体の向きは保つ。
        heading -= THREE.MathUtils.degToRad(nextYaw - previousYaw);
        applyFacing();
      }
      // 追従中のドラッグは、体とカメラを一緒に回す。
      updateCamera();
    }
    function pointerUp() { drag = null; }
    canvas.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
    window.addEventListener('blur', pointerUp);
    setTurnSpeed(data.turnSpeed ?? 120);
    setMoveSpeed(data.moveSpeed ?? 1);
    setCollision(data.collisionRadius, data.idleWhenBlocked);
    setGround(data.stepHeight, data.maxSlope, data.groundOffset);
    setEnabled(controlsEnabled);
    function destroy() {
      local.object3D.visible = localVisible;
      canvas.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
      window.removeEventListener('blur', pointerUp);
      if (original.parent.isConnected) {
        original.threeParent.add(camera.object3D);
        camera.setAttribute('position', original.position);
        camera.setAttribute('rotation', original.rotation);
        camera.setAttribute('camera', original.camera, true);
        camera.setAttribute('look-controls', original.look);
        camera.setAttribute('wasd-controls', original.wasd);
      }
      if (originalAvatar) {
        if (local.isConnected) {
          originalAvatar.parent.add(local.object3D);
          local.setAttribute('position', originalAvatar.position);
          local.setAttribute('rotation', originalAvatar.rotation);
          local.setAttribute('scale', originalAvatar.scale);
        }
        if (!originalAvatar.hadLocalClass) local.classList.remove('local-avatar');
      }
      player.remove();
    }
    return { player: player, localAvatar: local, setAvatarDirection: setAvatarDirection, setCameraFollow: setCameraFollow, setView: setView, setEyeHeight: setEyeHeight, setTurnSpeed: setTurnSpeed, setMoveSpeed: setMoveSpeed, setCollision: setCollision, setGround: setGround, setEnabled: setEnabled, setFaceMovement: setFaceMovement, setCameraSettings: setCameraSettings, reset: reset, clearInput: clearInput, faceMovement: faceMovement, getPose: getPose, destroy: destroy };
  }

  // すでに配置したGLBを、そのまま本人として操作する初回用コンポーネント。
  AFRAME.registerComponent('avatar', {
    after: ['vr-solid-controls'],
    schema: {
      view: { type: 'string', default: 'third' },
      enabled: { type: 'boolean', default: true },
      moveSpeed: { type: 'number', default: 1 },
      collisionRadius: { type: 'number', default: 0.35 },
      idleWhenBlocked: { type: 'boolean', default: false },
      stepHeight: { type: 'number', default: 0.25 },
      maxSlope: { type: 'number', default: 45 },
      groundOffset: { type: 'number', default: 0 },
      avatarDirection: { type: 'number', default: 0 },
      faceMovement: { type: 'boolean', default: true },
      cameraFollow: { type: 'boolean', default: false },
      turnSpeed: { type: 'number', default: 120 },
      eyeHeight: { type: 'number', default: 1.6 },
      cameraOffset: { type: 'vec3', default: { x: 0.6, y: 2, z: 3 } },
      lookHeight: { type: 'number', default: 1.1 },
      walk: { type: 'string', default: '' },
      idle: { type: 'string', default: '' }
    },
    init: function init() {
      this.removed = false;
      this.moving = false;
      // 選択を素早く変えても、古いGLBの読み込み結果で上書きしない。
      this.guardModelLoading = this.guardModelLoading.bind(this);
      this.el.addEventListener('componentinitialized', this.guardModelLoading);
      this.guardModelLoading();
      this.start = this.start.bind(this);
      const scene = this.el.sceneEl;
      this.scene = scene;
      if (scene.hasLoaded) this.start();
      else scene.addEventListener('loaded', this.start, { once: true });
    },
    update: function update(previous) {
      if (!this.controls) return;
      if (this.controls && previous.view !== this.data.view) {
        if (this.data.view === 'first' || this.data.view === 'third') this.controls.setView(this.data.view);
        else console.warn('view は first または third にしてください。');
      }
      if (previous.cameraFollow !== this.data.cameraFollow) {
        this.controls.setCameraFollow(this.data.cameraFollow);
      }
      if (previous.turnSpeed !== this.data.turnSpeed) this.controls.setTurnSpeed(this.data.turnSpeed);
      if (previous.moveSpeed !== this.data.moveSpeed) this.controls.setMoveSpeed(this.data.moveSpeed);
      if (previous.collisionRadius !== this.data.collisionRadius || previous.idleWhenBlocked !== this.data.idleWhenBlocked) {
        this.controls.setCollision(this.data.collisionRadius, this.data.idleWhenBlocked);
      }
      if (previous.stepHeight !== this.data.stepHeight || previous.maxSlope !== this.data.maxSlope || previous.groundOffset !== this.data.groundOffset) {
        this.controls.setGround(this.data.stepHeight, this.data.maxSlope, this.data.groundOffset);
      }
      if (previous.enabled !== this.data.enabled) this.controls.setEnabled(this.data.enabled);
      if (previous.faceMovement !== this.data.faceMovement) this.controls.setFaceMovement(this.data.faceMovement);
      if (previous.avatarDirection !== this.data.avatarDirection) this.controls.setAvatarDirection(this.data.avatarDirection);
      const offset = this.data.cameraOffset, oldOffset = previous.cameraOffset || {};
      if (offset.x !== oldOffset.x || offset.y !== oldOffset.y || offset.z !== oldOffset.z || previous.lookHeight !== this.data.lookHeight) {
        this.controls.setCameraSettings(offset, this.data.lookHeight);
      }
      if (this.controls && previous.eyeHeight !== this.data.eyeHeight) {
        this.controls.setEyeHeight(this.data.eyeHeight);
      }
      if (previous.walk !== this.data.walk || previous.idle !== this.data.idle) this.syncMotion(true);
    },
    syncMotion: function syncMotion(updateClips = false) {
      const el = this.el;
      if (!this.controls || (!this.data.walk && !this.data.idle && !el.hasAttribute('avatar-motion'))) return;
      const target = '#' + this.controls.player.id;
      if (!el.hasAttribute('avatar-motion')) {
        this.addedMotion = true;
        el.setAttribute('avatar-motion', { target: target, walk: this.data.walk, idle: this.data.idle });
      } else {
        if (!el.components['avatar-motion']?.data.target) {
          this.boundMotionTarget = true;
          el.setAttribute('avatar-motion', 'target', target);
        }
        if (updateClips) el.setAttribute('avatar-motion', { walk: this.data.walk, idle: this.data.idle });
      }
    },
    guardModelLoading: function guardModelLoading() {
      const component = this.el.components['gltf-model'];
      if (!component || this.modelLoader === component.loader) return;
      const owner = this;
      const loader = component.loader;
      const originalLoad = loader.load;
      function current() { return !owner.removed && owner.el.components['gltf-model'] === component; }
      this.modelLoader = loader;
      this.originalModelLoad = originalLoad;
      this.guardedModelLoad = function load(source, loaded, progress, failed) {
        return originalLoad.call(this, source, function onLoaded(model) {
          if (current() && component.data === source) loaded(model);
        }, progress, function onFailed(error) {
          if (current() && component.data === source && failed) failed(error);
        });
      };
      loader.load = this.guardedModelLoad;
    },
    start: function start() {
      if (this.removed || this.controls) return;
      const el = this.el, scene = el.sceneEl;
      const camera = scene.querySelector('a-camera, [camera]');
      if (!['first', 'third'].includes(this.data.view) || !camera || scene.hasAttribute('vr-kit') || scene.vrAvatarOwner) {
        console.warn('カメラ1つと操作対象1体で使ってください。vr-kitとは併用せず、view は first または third を指定します。');
        return;
      }
      this.controls = setupThirdPerson(scene, camera, this.data, ++nextId, el);
      scene.vrAvatarOwner = this;
      this.syncMotion();
      el.emit('vr-avatar-ready', {}, false);
    },
    tick: function tick(time, delta) {
      this.moving = !!(this.controls && this.controls.faceMovement(delta));
    },
    pause: function pause() {
      this.moving = false;
      if (this.controls) this.controls.clearInput();
    },
    remove: function remove() {
      this.removed = true;
      const scene = this.scene;
      scene.removeEventListener('loaded', this.start);
      this.el.removeEventListener('componentinitialized', this.guardModelLoading);
      if (this.modelLoader?.load === this.guardedModelLoad) this.modelLoader.load = this.originalModelLoad;
      if (this.addedMotion) this.el.removeAttribute('avatar-motion');
      else if (this.boundMotionTarget && this.el.hasAttribute('avatar-motion')) this.el.setAttribute('avatar-motion', 'target', '');
      if (this.controls) this.controls.destroy();
      if (scene.vrAvatarOwner === this) delete scene.vrAvatarOwner;
    }
  });

  AFRAME.registerComponent('vr-kit', {
    schema: {
      room: { type: 'string', default: 'main' },
      avatar: { type: 'string', default: 'red' },
      avatarDirection: { type: 'number', default: 0 },
      view: { type: 'string', default: 'first' },
      cameraOffset: { type: 'vec3', default: { x: 0.6, y: 2, z: 3 } },
      lookHeight: { type: 'number', default: 1.1 },
      walk: { type: 'string', default: '' },
      idle: { type: 'string', default: '' }
    },
    init: function init() {
      this.removed = false;
      this.start = this.start.bind(this);
      if (this.el.hasLoaded) this.start();
      else this.el.addEventListener('loaded', this.start, { once: true });
    },
    start: async function start() {
      if (this.app || this.starting || this.removed) return;
      this.starting = true;
      const scene = this.el;
      const camera = scene.querySelector('a-camera, [camera]');
      if (!camera) {
        console.warn('カメラが見つかりません。a-cameraを置いてください');
        return;
      }
      const uniqueId = ++nextId;
      if (!scene.id) scene.id = 'vr-auto-scene-' + uniqueId;
      if (!camera.id) camera.id = 'vr-auto-camera-' + uniqueId;
      let app;
      this.catalogRequest = new AbortController();
      try {
        const response = await fetch('/vr-kit/models.json', { cache: 'no-store', signal: this.catalogRequest.signal });
        if (!response.ok) throw new Error('モデル一覧を読み込めません。サーバーを確認して再読み込みしてください');
        const catalog = await response.json();
        if (this.removed) return;
        const initial = catalog.find(function findInitial(model) {
          return model.id === this.data.avatar || model.file === this.data.avatar || model.src === this.data.avatar;
        }, this);
        if (!initial) throw new Error('モデルが見つかりません：' + this.data.avatar + '（public/modelsへの配置とサーバーの再起動を確認）');
        if (!['first', 'third'].includes(this.data.view)) throw new Error('view は first または third にしてください');
        if (this.data.view === 'third') {
          this.thirdPerson = setupThirdPerson(scene, camera, this.data, uniqueId);
        }
        const models = Object.fromEntries(catalog.map(function modelURL(model) { return [model.id, model.src]; }));
        if (this.data.avatarDirection !== 0) models[initial.id] = { src: initial.src, yawOffset: this.data.avatarDirection };
        app = vrKit({
          scene: '#' + CSS.escape(scene.id),
          camera: '#' + CSS.escape(camera.id),
          room: this.data.room,
          avatar: initial.id,
          models: models,
          player: this.thirdPerson ? '#' + this.thirdPerson.player.id : undefined,
          localAvatar: this.thirdPerson ? '#' + this.thirdPerson.localAvatar.id : undefined,
          eyeHeight: this.thirdPerson ? 0 : 1.6,
          walk: this.data.walk,
          idle: this.data.idle
        });
      } catch (error) {
        if (this.removed) return;
        if (this.thirdPerson) { this.thirdPerson.destroy(); this.thirdPerson = null; }
        console.warn(error.message);
        return;
      } finally {
        this.starting = false;
      }
      this.app = app;
      this.cleanup = function cleanup() { app.destroy(); };
    },
    remove: function remove() {
      this.removed = true;
      if (this.catalogRequest) this.catalogRequest.abort();
      this.el.removeEventListener('loaded', this.start);
      if (this.cleanup) this.cleanup();
      if (this.thirdPerson) this.thirdPerson.destroy();
    }
  });
})();
