/** Shared GLSL. Colours are linear; tone mapping happens at output. */

export const SKY_FUNCTION_GLSL = /* glsl */ `
  uniform vec3 uSunDir;
  vec3 skyColor(vec3 dir) {
    float h = dir.y;
    vec3 zenith      = vec3(0.012, 0.010, 0.050);
    vec3 upper       = vec3(0.045, 0.030, 0.150);
    vec3 mid         = vec3(0.090, 0.032, 0.170);
    vec3 horizonCool = vec3(0.110, 0.055, 0.260);
    vec3 horizonWarm = vec3(0.520, 0.150, 0.130);
    vec2 flatDir = normalize(dir.xz + vec2(1e-5));
    vec2 flatSun = normalize(uSunDir.xz + vec2(1e-5));
    float sunAmt = max(dot(flatDir, flatSun), 0.0);
    vec3 horizon = mix(horizonCool, horizonWarm, pow(sunAmt, 3.0));
    vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.16, h));
    col = mix(col, upper, smoothstep(0.10, 0.42, h));
    col = mix(col, zenith, smoothstep(0.38, 0.95, h));
    col = mix(col, vec3(0.045, 0.030, 0.110), smoothstep(0.0, -0.22, h));
    float sd = max(dot(normalize(dir), uSunDir), 0.0);
    col += vec3(1.0, 0.42, 0.22) * pow(sd, 48.0) * 0.45;
    col += vec3(0.75, 0.22, 0.42) * pow(sd, 6.0) * 0.08;
    return col;
  }
`;

export const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to far plane
  }
`;

export const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uMoonDir;
  ${SKY_FUNCTION_GLSL}
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  void main() {
    vec3 dir = normalize(vDir);
    vec3 col = skyColor(dir);

    // Stars: one candidate per cell, faded near the horizon and the sunset.
    vec3 p = dir * 210.0;
    vec3 cell = floor(p);
    float rnd = hash13(cell);
    if (rnd > 0.975) {
      vec3 offset = vec3(hash13(cell + 1.7), hash13(cell + 4.1), hash13(cell + 9.3));
      float d = length(fract(p) - offset);
      float star = smoothstep(0.11, 0.0, d);
      float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + rnd * 4.0) + rnd * 60.0);
      float fade = smoothstep(0.06, 0.45, dir.y) * (1.0 - 0.8 * max(dot(dir, uSunDir), 0.0));
      col += vec3(0.75, 0.82, 1.0) * star * twinkle * fade * (rnd - 0.975) * 60.0;
    }

    // Moon with a soft cyan halo.
    float md = max(dot(dir, uMoonDir), 0.0);
    col += vec3(0.95, 0.97, 1.0) * smoothstep(0.99955, 0.99975, md) * 2.4;
    col += vec3(0.35, 0.6, 1.0) * pow(md, 260.0) * 0.6;
    col += vec3(0.25, 0.35, 0.9) * pow(md, 24.0) * 0.08;

    // Dither to hide banding in the gradient.
    col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const WATER_FRAGMENT = /* glsl */ `
  varying vec3 vWorld;
  uniform float uTime;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uDeep;
  uniform vec3 uGlow;
  ${SKY_FUNCTION_GLSL}
  vec2 wave(vec2 p, vec2 d, float freq, float speed, float amp) {
    float ph = dot(p, d) * freq + uTime * speed;
    return d * cos(ph) * freq * amp;
  }
  void main() {
    vec2 p = vWorld.xz;
    vec2 g = vec2(0.0);
    g += wave(p, normalize(vec2(1.0, 0.6)), 0.09, 0.7, 0.9);
    g += wave(p, normalize(vec2(-0.7, 1.0)), 0.16, 1.1, 0.45);
    g += wave(p, normalize(vec2(0.2, -1.0)), 0.31, 1.7, 0.22);
    g += wave(p, normalize(vec2(-1.0, -0.3)), 0.57, 2.3, 0.10);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    vec3 r = reflect(-v, n);
    r.y = abs(r.y);
    vec3 col = mix(uDeep, skyColor(r), 0.06 + 0.55 * fres);
    col += vec3(1.0, 0.5, 0.3) * pow(max(dot(r, uSunDir), 0.0), 220.0) * 1.2;
    float d = length(p);
    col += uGlow * exp(-d * 0.03) * (0.25 + 0.2 * n.x);
    float dist = length(vWorld - cameraPosition);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const BEAM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const BEAM_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uStrength;
  void main() {
    float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.04, vUv.y);
    float shimmer = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 3.0);
    gl_FragColor = vec4(uColor * uStrength * fade * shimmer, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const MOTES_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.25 + aSeed * 6.2831) * 1.6;
    p.x += sin(uTime * 0.17 + aSeed * 12.0) * 1.2;
    p.z += cos(uTime * 0.21 + aSeed * 9.0) * 1.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = 0.6 + aSeed * 1.1;
    gl_PointSize = size * uPixelRatio * (140.0 / max(-mv.z, 1.0));
    vColor = aColor;
    vAlpha = (0.55 + 0.45 * sin(uTime * (0.8 + aSeed) + aSeed * 40.0)) * smoothstep(260.0, 40.0, -mv.z);
  }
`;

export const MOTES_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * a * a * vAlpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
