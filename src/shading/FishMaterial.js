import * as THREE from 'three';

/**
 * The surface. A MeshPhysicalMaterial (for a real clearcoat "mucus" layer and PBR
 * base) whose albedo, roughness and normal are rewritten in onBeforeCompile to
 * composite the layered chromatophore stack the research describes, bottom to top:
 *
 *   1. countershaded base   dark dorsal -> pale belly (Thayer's law), driven by
 *                           the per-vertex dorsoventral factor.
 *   2. melanophore layer    the reaction-diffusion V field, thresholded into
 *                           crisp bars/stripes/spots.
 *   3. xanthophore layer    bright yellow->red pigment where enabled.
 *   4. leucophore markings  hard species masks (clownfish bars, orca patches).
 *   5. iridophore layer     a view-dependent thin-film sheen added as emissive,
 *                           concentrated on the flanks and suppressed on the dark
 *                           melanophore bars (guanine platelets sit in the pale
 *                           interstripes, not under the black).
 * plus procedural scale normals and a cheap wrapped-diffuse translucency.
 */

const MARKINGS = { none: 0, clownfish: 1, orca: 2 };

export function makeBodyMaterial(surface, rdTexture, shared) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(surface.flankColor),
    roughness: surface.roughness,
    metalness: surface.metalness,
    clearcoat: surface.clearcoat,
    clearcoatRoughness: surface.clearcoatRoughness,
    sheen: 0.0,
  });
  mat.defines = { USE_UV: '' };
  mat.envMapIntensity = 0.55;

  const u = {
    uRD: { value: rdTexture },
    uTime: shared.time,
    uDorsalColor: { value: new THREE.Color(surface.dorsalColor) },
    uFlankColor: { value: new THREE.Color(surface.flankColor) },
    uBellyColor: { value: new THREE.Color(surface.bellyColor) },
    uPatternColor: { value: new THREE.Color(surface.patternColor) },
    uXanthoColor: { value: new THREE.Color(surface.xanthoColor) },
    uSSSColor: { value: new THREE.Color(surface.sssColor) },
    uLateralColor: { value: new THREE.Color(surface.lateralLineColor) },
    uCountershade: { value: surface.countershade },
    uCountershadeSharp: { value: surface.countershadeSharp },
    uXantho: { value: surface.xantho },
    uThreshold: { value: surface.threshold ?? 0.22 },
    uSoftness: { value: surface.softness ?? 0.09 },
    uContrast: { value: surface.contrast ?? 0.5 },
    uPatternStrength: { value: surface.enabled === false ? 0 : 1 },
    uLateralLine: { value: surface.lateralLine },
    uLateralWidth: { value: surface.lateralLineWidth },
    uScaleDensity: { value: surface.scaleDensity },
    uScaleDepth: { value: surface.scaleDepth },
    uScaleAspect: { value: surface.scaleAspect },
    uRoughPattern: { value: surface.roughnessPattern },
    uIrid: { value: surface.iridescence },
    uIridFlank: { value: surface.iridFlank },
    uIridOnPattern: { value: surface.iridOnPattern },
    uIridThickMin: { value: surface.iridThicknessMin },
    uIridThickMax: { value: surface.iridThicknessMax },
    uSSS: { value: surface.sss },
    uRDScale: { value: new THREE.Vector2(surface._rdScaleU ?? 1, surface._rdScaleV ?? 1) },
    uMarkings: { value: MARKINGS[surface.markings] || 0 },
  };
  mat.userData.u = u;
  // Thin-film clear ceiling: keep three's own iridescence off; we do our own.
  mat.iridescence = 0.0;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aDorsal;\nvarying float vDor;\nvarying vec3 vWPos;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n vDor = aDorsal;\n vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;`);
    // worldpos_vertex only emits when needed; force it by ensuring transformed exists.
    if (!shader.vertexShader.includes('vDor = aDorsal;')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vDor = aDorsal;\n vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\n#include <project_vertex>`
      );
    }

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_COMMON)
      .replace('#include <color_fragment>', COLOR_FRAG)
      .replace('#include <roughnessmap_fragment>', ROUGH_FRAG)
      .replace('#include <normal_fragment_maps>', NORMAL_FRAG)
      .replace('#include <emissivemap_fragment>', EMISSIVE_FRAG);
  };

  return mat;
}

const FRAG_COMMON = /* glsl */ `
#include <common>
varying float vDor;
varying vec3 vWPos;
uniform sampler2D uRD;
uniform float uTime;
uniform vec3 uDorsalColor, uFlankColor, uBellyColor, uPatternColor, uXanthoColor, uSSSColor, uLateralColor;
uniform float uCountershade, uCountershadeSharp, uXantho, uThreshold, uSoftness, uContrast, uPatternStrength;
uniform float uLateralLine, uLateralWidth, uScaleDensity, uScaleDepth, uScaleAspect, uRoughPattern;
uniform float uIrid, uIridFlank, uIridOnPattern, uIridThickMin, uIridThickMax, uSSS;
uniform vec2 uRDScale;
uniform int uMarkings;

// Cheap thin-film-ish spectral ramp: maps a phase to a hue sweep.
vec3 iridPalette(float t){
  return 0.5 + 0.5*cos(6.2831853*(vec3(1.0,0.9,0.75)*t + vec3(0.0,0.33,0.66)));
}

float rdMask(vec2 uv){
  vec2 ruv = vec2(uv.y * uRDScale.x, uv.x * uRDScale.y);
  float v = texture2D(uRD, ruv).y;
  float m = smoothstep(uThreshold - uSoftness, uThreshold + uSoftness, v);
  return clamp((m - 0.5) * (0.6 + uContrast*1.4) + 0.5, 0.0, 1.0);
}

// Procedural overlapping-scale height, used for a subtle bump normal. Rounded,
// tiled, and deliberately low-contrast so it reads as fish scales in raking
// light rather than a checkerboard.
float scaleField(vec2 uv){
  float rows = uScaleDensity;
  float y = uv.y * rows;                    // along body
  float x = uv.x * rows * uScaleAspect;     // around body
  x += 0.5 * step(1.0, mod(y, 2.0));        // brick offset every other row
  vec2 g = vec2(fract(x) - 0.5, fract(y) - 0.5);
  float d = length(g * vec2(1.0, 1.3));
  // a soft round lens, and only the leading crescent of each scale catches light
  float scale = smoothstep(0.52, 0.30, d);
  return scale;
}

float clownBars(vec2 uv){
  // three white bars: behind head, mid-body, on the peduncle.
  float b = 0.0;
  b += smoothstep(0.03, 0.0, abs(uv.y - 0.20) - 0.05);
  b += smoothstep(0.03, 0.0, abs(uv.y - 0.50) - 0.06);
  b += smoothstep(0.03, 0.0, abs(uv.y - 0.80) - 0.035);
  return clamp(b, 0.0, 1.0);
}
`;

const COLOR_FRAG = /* glsl */ `
#include <color_fragment>
{
  float d = vDor; // -1 ventral .. +1 dorsal
  // Countershade: pale belly, dark back. cs is the dorsoventral position with an
  // adjustable transition sharpness; the belly->flank->dorsal ramp is built from
  // it, then blended in by uCountershade so 0 = flat flank colour (e.g. an orca,
  // whose black/white is a hard mask, not a gradient) and 1 = full countershading.
  float cs = smoothstep(-1.0, 1.0, d);
  cs = pow(cs, mix(1.0, 2.5, uCountershadeSharp));
  vec3 grad = mix(uBellyColor, uFlankColor, smoothstep(0.0, 0.5, cs));
  grad = mix(grad, uDorsalColor, smoothstep(0.5, 1.0, cs));
  vec3 base = mix(uFlankColor, grad, uCountershade);

  // Melanophore pattern (reaction-diffusion).
  float mask = rdMask(vUv) * uPatternStrength;
  vec3 col = mix(base, uPatternColor, mask);

  // Xanthophore bright pigment on the flanks/belly.
  float xanthoMask = uXantho * (1.0 - smoothstep(0.2, 0.9, cs)) * (1.0 - mask);
  col = mix(col, uXanthoColor, xanthoMask);

  // Lateral-line stripe near mid-flank.
  float ll = smoothstep(uLateralWidth, 0.0, abs(d - 0.02)) * uLateralLine;
  col = mix(col, uLateralColor, ll * 0.7);

  // Hard species markings.
  if (uMarkings == 1) { // clownfish: white leucophore bars with black piping
    float bar = clownBars(vUv);
    col = mix(col, vec3(0.96,0.97,0.98), bar);
    float edge = clamp(clownBars(vUv + vec2(0.0, 0.018)) - clownBars(vUv - vec2(0.0,0.018)), 0.0, 1.0);
    col = mix(col, vec3(0.03,0.03,0.04), abs(edge)*0.9);
  } else if (uMarkings == 2) { // orca: crisp black/white + eye patches + saddle
    vec3 white = vec3(0.95, 0.96, 0.93);
    // Sharp countershade cutline: white throat/belly up to about mid-flank, with
    // a rear flank "flash" sweeping up toward the tail.
    float cut = -0.15 + 0.35 * smoothstep(0.55, 0.95, vUv.y); // rises toward the tail
    float belly = smoothstep(cut + 0.05, cut - 0.05, d);       // hard-ish edge
    col = mix(col, white, belly);
    // Two oblique eye patches, one per flank (vUv.x ~0.3 and ~0.7), just above and
    // behind the eye near the head.
    float ep = (1.0 - smoothstep(0.0, 1.0, length((vUv - vec2(0.32, 0.15)) * vec2(7.0, 15.0))))
             + (1.0 - smoothstep(0.0, 1.0, length((vUv - vec2(0.68, 0.15)) * vec2(7.0, 15.0))));
    col = mix(col, white, clamp(ep, 0.0, 1.0) * step(0.1, d)); // only on the upper flank
    // Grey saddle patch behind the dorsal fin.
    float saddle = (1.0 - smoothstep(0.0, 0.06, abs(vUv.y - 0.52) - 0.03)) * smoothstep(0.55, 1.0, cs);
    col = mix(col, vec3(0.34, 0.38, 0.42), saddle * 0.6);
  }

  diffuseColor.rgb = col;
  // Very light scale shading: a whisper of tonal variation, not a grid.
  if (uScaleDensity > 0.5) diffuseColor.rgb *= (0.96 + 0.04 * scaleField(vUv));
}
`;

const ROUGH_FRAG = /* glsl */ `
#include <roughnessmap_fragment>
{
  float mask = rdMask(vUv) * uPatternStrength;
  roughnessFactor = clamp(roughnessFactor + mask * uRoughPattern, 0.03, 1.0);
}
`;

const NORMAL_FRAG = /* glsl */ `
#include <normal_fragment_maps>
if (uScaleDepth > 0.0001 && uScaleDensity > 0.5) {
  float h = scaleField(vUv);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  // Clamp the derivative so under-sampled/curved texels don't spark into a grid.
  dh = clamp(dh, -0.25, 0.25);
  normal = normalize(normal - vec3(dh, 0.0) * uScaleDepth * 0.35);
}
`;

const EMISSIVE_FRAG = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 3.0);
  float flankMask = 1.0 - smoothstep(0.0, 1.0, abs(vDor)); // strongest at midline
  flankMask = mix(1.0, flankMask, uIridFlank);
  float mask = rdMask(vUv) * uPatternStrength;
  float iridMask = clamp(flankMask * (1.0 + uIridOnPattern * mask), 0.0, 1.0);
  // thickness -> hue phase, swept by view angle (Fresnel).
  float thick = mix(uIridThickMin, uIridThickMax, fres);
  vec3 sheen = iridPalette(thick / 400.0 + fres * 0.5);
  totalEmissiveRadiance += sheen * fres * uIrid * iridMask * 1.2;

  // Cheap wrapped-diffuse translucency: warm bleed on grazing angles.
  totalEmissiveRadiance += uSSSColor * fres * uSSS * 0.25;
}
`;

/**
 * Push surface parameters into an already-compiled body material's uniforms, so
 * the GUI can retune colour, iridescence, countershading etc. live without ever
 * triggering a shader recompile (which would hitch on every slider frame).
 */
export function applyBodySurface(mat, surface, pattern) {
  const u = mat.userData.u;
  u.uDorsalColor.value.set(surface.dorsalColor);
  u.uFlankColor.value.set(surface.flankColor);
  u.uBellyColor.value.set(surface.bellyColor);
  u.uPatternColor.value.set(surface.patternColor);
  u.uXanthoColor.value.set(surface.xanthoColor);
  u.uSSSColor.value.set(surface.sssColor);
  u.uLateralColor.value.set(surface.lateralLineColor);
  u.uCountershade.value = surface.countershade;
  u.uCountershadeSharp.value = surface.countershadeSharp;
  u.uXantho.value = surface.xantho;
  u.uThreshold.value = pattern.threshold;
  u.uSoftness.value = pattern.softness;
  u.uContrast.value = pattern.contrast;
  u.uPatternStrength.value = pattern.enabled ? 1 : 0;
  u.uLateralLine.value = surface.lateralLine;
  u.uLateralWidth.value = surface.lateralLineWidth;
  u.uScaleDensity.value = surface.scaleDensity;
  u.uScaleDepth.value = surface.scaleDepth;
  u.uScaleAspect.value = surface.scaleAspect;
  u.uRoughPattern.value = surface.roughnessPattern;
  u.uIrid.value = surface.iridescence;
  u.uIridFlank.value = surface.iridFlank;
  u.uIridOnPattern.value = surface.iridOnPattern;
  u.uIridThickMin.value = surface.iridThicknessMin;
  u.uIridThickMax.value = surface.iridThicknessMax;
  u.uSSS.value = surface.sss;
  u.uRDScale.value.set(pattern.scaleU, pattern.scaleV);
  u.uMarkings.value = MARKINGS[surface.markings] || 0;
  mat.color.set(surface.flankColor);
  mat.roughness = surface.roughness;
  mat.metalness = surface.metalness;
  mat.clearcoat = surface.clearcoat;
  mat.clearcoatRoughness = surface.clearcoatRoughness;
}

export function applyFinSurface(mat, surface) {
  const u = mat.userData.u;
  u.uRayContrast.value = surface.finRayContrast;
  u.uFinTint.value.set(surface.finTint);
  u.uFinEdge.value.set(surface.patternColor);
  u.uFinOpacity.value = finBaseOpacity(surface);
  u.uFinGlow.value.set(surface.sssColor);
  u.uFinTrans.value = surface.finTransmission;
  mat.color.set(surface.finTint);
  mat.roughness = surface.finRoughness;
  mat.anisotropy = surface.finAnisotropy;
  mat.opacity = finBaseOpacity(surface);
}

/**
 * Fin material: translucent ray-and-webbing membrane. Anisotropic highlights
 * stretch along the rays, the trailing edge fades to transparent, and faint dark
 * lines mark the ray positions.
 */
export function makeFinMaterial(surface, shared) {
  // Note: no `transmission`. True IBL refraction is a heavy extra render pass and
  // its shader path is fragile across drivers; a thin alpha membrane with a
  // fresnel translucency glow reads just as well for webbing and always compiles.
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(surface.finTint),
    roughness: surface.finRoughness,
    metalness: 0.0,
    clearcoat: surface.clearcoat * 0.6,
    clearcoatRoughness: 0.1,
    anisotropy: surface.finAnisotropy,
    anisotropyRotation: Math.PI / 2,
    transparent: true,
    opacity: finBaseOpacity(surface),
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  mat.defines = { USE_UV: '' };

  const u = {
    uTime: shared.time,
    uRayContrast: { value: surface.finRayContrast },
    uFinTint: { value: new THREE.Color(surface.finTint) },
    uFinEdge: { value: new THREE.Color(surface.patternColor) },
    uFinOpacity: { value: finBaseOpacity(surface) },
    uFinGlow: { value: new THREE.Color(surface.sssColor) },
    uFinTrans: { value: surface.finTransmission },
  };
  mat.userData.u = u;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aRay;\nattribute float aSpan;\nvarying float vRay;\nvarying float vSpan;`)
      .replace('#include <project_vertex>', `vRay = aRay;\n vSpan = aSpan;\n#include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vRay;\nvarying float vSpan;\nuniform float uRayContrast, uFinOpacity, uFinTrans;\nuniform vec3 uFinTint, uFinEdge, uFinGlow;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{
        float rays = 26.0;
        float rl = abs(fract(vRay * rays) - 0.5) * 2.0;
        float ray = smoothstep(0.55, 0.95, rl);            // dark line between rays
        vec3 col = mix(uFinTint, uFinEdge, ray * uRayContrast);
        col = mix(col, uFinEdge, smoothstep(0.7, 1.0, vSpan) * 0.25); // darker margin
        diffuseColor.rgb = col;
      }`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\n {
        // Frayed, fading trailing edge; more translucent webbing reads as lower alpha.
        float edgeFade = 1.0 - smoothstep(0.82, 1.0, vSpan);
        float ripple = 0.85 + 0.15 * sin(vRay * 40.0);
        diffuseColor.a *= mix(1.0, edgeFade * ripple, 0.9) * uFinOpacity;
      }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n {
        // Backlit-membrane glow: brightest at grazing angles, scaled by translucency.
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 2.0);
        totalEmissiveRadiance += uFinGlow * fres * uFinTrans * 0.5;
      }`);
  };

  return mat;
}

/** Translucent webbing reads as lower base opacity, but keep a floor so fins stay
 *  visible against dark water rather than dissolving into smudges. */
function finBaseOpacity(surface) {
  return Math.max(0.4, surface.finOpacity * (1.0 - 0.28 * surface.finTransmission));
}
