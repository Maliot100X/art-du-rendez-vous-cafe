#version 300 es
// Otis FaceEngine vertex warp, adapted for a rectangular photo:
// a 128x128 grid mesh, 4 grab slots, gaussian falloff SIGMA 0.072 UV
// widened 35% with pull length. Aspect-corrected: distances are measured
// in units of frame height, so the otis constants mean the same on this
// 16:9 frame as on otis's square stage. No face rig here: no disc,
// no landmarks, no expression data — the vertex shader only warps.
in vec2 aUv;
uniform vec2 uView; // canvas size in CSS px
uniform vec4 uStage; // x, y, w, h of the photo rect in canvas px
uniform vec4 uGrab[4]; // per slot: anchor u, anchor v, offset x px, offset y px
out vec2 vUv;
out float vStretch;

void main() {
  vec2 p = uStage.xy + aUv * uStage.zw;
  float aspect = uStage.z / uStage.w;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 d = (aUv - uGrab[i].xy) * vec2(aspect, 1.0);
    float len = length(uGrab[i].zw) / uStage.w;
    float sig = 0.072 * (1.0 + 0.35 * len);
    float w = exp(-dot(d, d) / (2.0 * sig * sig));
    p += uGrab[i].zw * w;
    s += w * len;
  }
  vUv = aUv;
  vStretch = s;
  vec2 c = p / uView * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}
