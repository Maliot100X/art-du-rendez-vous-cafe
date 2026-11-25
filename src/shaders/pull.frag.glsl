#version 300 es
// Single-photo fragment shader. The texture is sampled with a cover-fit
// transform so the 3:2 bar photo fills the 16:9 frame without squashing.
// The only stretch feedback is a faint warm lift where the photo is
// pulled — no blush, no disc cut-out, no expression crossfade: those
// belong to a face, not a bar photo.
precision highp float;
in vec2 vUv;
in float vStretch;
uniform sampler2D uTex;
uniform vec4 uCover; // scaleX, scaleY, offsetX, offsetY — cover-fit of the photo
out vec4 outColor;

void main() {
  vec2 uv = vUv * uCover.xy + uCover.zw;
  vec4 c = texture(uTex, uv);
  c.rgb *= 1.0 + vec3(0.06, 0.0, -0.04) * clamp(vStretch * 0.9, 0.0, 1.0);
  outColor = c;
}
