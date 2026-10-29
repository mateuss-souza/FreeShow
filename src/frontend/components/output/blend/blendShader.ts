// Draws one projector's slice of the blended canvas with WebGL.
//
// The fragment shader mirrors blendMath.ts (mask, black lift, ramps); change both together.
// Input is either a captured frame (RGBA/BGRA bytes, as FreeShow's capture path delivers them)
// or any DOM image source (video, canvas, image) for previews and testing.

import type { StreamFrame } from "../../drawer/live/streamCanvas"
import { CURVE_IDS, PATTERN_IDS, canvasSize, getSlices, normalizeBlendGroup, type BlendGroupConfig, type BlendPattern } from "./blendMath"

const VERTEX_SHADER = "attribute vec2 a;varying vec2 v;void main(){v=vec2((a.x+1.0)*0.5,1.0-(a.y+1.0)*0.5);gl_Position=vec4(a,0.0,1.0);}"

export const BLEND_FRAGMENT_SHADER = `
precision highp float;
varying vec2 v;
uniform sampler2D t;
uniform float hasSource;
uniform float swapRB;
uniform vec2 canvasSize;   // whole blended image, px
uniform vec2 sliceOrigin;  // this projector's top-left in canvas px
uniform vec2 sliceSize;    // projector output, px
uniform float leftOverlap;
uniform float rightOverlap;
uniform float gamma;
uniform float curve;       // 0 linear, 1 smoothstep, 2 cosine
uniform float brightness;
uniform float blackLevel;
uniform float blackFeather;
uniform float pattern;     // see PATTERN_IDS
uniform float projector;   // index, for guide colours

float ramp(float t, float c) {
    float x = clamp(t, 0.0, 1.0);
    if (c < 0.5) return x;
    if (c > 1.5) return 0.5 - 0.5 * cos(3.14159265 * x);
    return x * x * (3.0 - 2.0 * x);
}

float lightWeight(float x) {
    float w = 1.0;
    if (leftOverlap > 0.0 && x < leftOverlap) w *= ramp(x / leftOverlap, curve);
    float fromRight = sliceSize.x - x;
    if (rightOverlap > 0.0 && fromRight < rightOverlap) w *= ramp(fromRight / rightOverlap, curve);
    return w;
}

float blackLift(float x) {
    if (blackLevel <= 0.0) return 0.0;
    float inLeft = leftOverlap > 0.0 ? x - leftOverlap : 1e9;
    float inRight = rightOverlap > 0.0 ? sliceSize.x - rightOverlap - x : 1e9;
    float d = min(inLeft, inRight);
    if (d <= 0.0) return 0.0;
    float f = blackFeather > 0.0 ? clamp(d / blackFeather, 0.0, 1.0) : 1.0;
    return blackLevel * ramp(f, 1.0);
}

float gridLine(vec2 p, float spacing, float width) {
    vec2 m = mod(p + width * 0.5, spacing);
    return (m.x < width || m.y < width) ? 1.0 : 0.0;
}

vec3 guideColor(float i) {
    float k = mod(i, 3.0);
    if (k < 0.5) return vec3(1.0, 0.15, 0.15);
    if (k < 1.5) return vec3(0.15, 1.0, 0.15);
    return vec3(0.2, 0.4, 1.0);
}

void main() {
    vec2 local = v * sliceSize;          // px inside this projector
    vec2 cp = sliceOrigin + local;        // px on the canvas
    float outside = (cp.x < 0.0 || cp.y < 0.0 || cp.x >= canvasSize.x || cp.y >= canvasSize.y) ? 1.0 : 0.0;

    // guides are drawn raw (unblended): each projector in its own colour, overlap borders in white
    if (pattern > 5.5) {
        vec3 c = guideColor(projector) * 0.35;
        float border = 0.0;
        if (leftOverlap > 0.0 && abs(local.x - leftOverlap) < 2.0) border = 1.0;
        if (rightOverlap > 0.0 && abs(sliceSize.x - rightOverlap - local.x) < 2.0) border = 1.0;
        if (local.x < 3.0 || local.x > sliceSize.x - 3.0) border = 1.0;
        c = mix(c, vec3(1.0), max(border, gridLine(cp, 100.0, 1.0) * 0.5));
        gl_FragColor = vec4(c, 1.0);
        return;
    }

    vec3 color;
    if (pattern < 0.5) {
        if (hasSource < 0.5 || outside > 0.5) color = vec3(0.0);
        else {
            vec4 s = texture2D(t, cp / canvasSize);
            color = mix(s.rgb, s.bgr, swapRB);
        }
    } else if (pattern < 1.5) {
        // alignment grid: thin every 100px, thick every 500px, centre cross
        float g = max(gridLine(cp, 100.0, 2.0), gridLine(cp, 500.0, 6.0));
        vec2 centre = canvasSize * 0.5;
        if (abs(cp.x - centre.x) < 4.0 || abs(cp.y - centre.y) < 4.0) g = 1.0;
        color = vec3(g);
    } else if (pattern < 2.5) color = vec3(1.0);
    else if (pattern < 3.5) color = vec3(0.5);
    else if (pattern < 4.5) color = vec3(0.0);
    else color = vec3(floor(v.y * 16.0) / 15.0); // 16-step grey ramp, top to bottom

    float mask = pow(lightWeight(local.x) * brightness, 1.0 / gamma);
    float lift = blackLift(local.x);
    color = lift + (1.0 - lift) * clamp(color, 0.0, 1.0) * mask;
    gl_FragColor = vec4(color, 1.0);
}
`

type Uniforms = Record<string, WebGLUniformLocation | null>

const UNIFORMS = ["t", "hasSource", "swapRB", "canvasSize", "sliceOrigin", "sliceSize", "leftOverlap", "rightOverlap", "gamma", "curve", "brightness", "blackLevel", "blackFeather", "pattern", "projector"]

export class BlendRenderer {
    private gl: WebGLRenderingContext | null = null
    private program: WebGLProgram | null = null
    private uniforms: Uniforms = {}
    private texture: WebGLTexture | null = null
    private textureSize = ""
    private canvas: HTMLCanvasElement | null = null

    private config: BlendGroupConfig = normalizeBlendGroup(null)
    private projector = 0
    private pattern: BlendPattern = "none"

    setConfig(config: Partial<BlendGroupConfig> | null | undefined, projector: number) {
        this.config = normalizeBlendGroup(config)
        this.projector = Math.max(0, Math.min(this.config.projectors - 1, Math.floor(projector) || 0))
    }

    setPattern(pattern: BlendPattern) {
        this.pattern = pattern in PATTERN_IDS ? pattern : "none"
    }

    /** the projector window shows nothing but this canvas, at the projector's native size */
    attach(canvas: HTMLCanvasElement) {
        if (this.canvas === canvas && this.gl) return true
        this.destroy()
        this.canvas = canvas
        const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })
        if (!gl) return false
        this.gl = gl

        canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault()
            this.gl = null
            this.program = null
            this.texture = null
            this.textureSize = ""
        })

        const vertex = gl.createShader(gl.VERTEX_SHADER)
        const fragment = gl.createShader(gl.FRAGMENT_SHADER)
        const program = gl.createProgram()
        if (!vertex || !fragment || !program) return false
        gl.shaderSource(vertex, VERTEX_SHADER)
        gl.compileShader(vertex)
        gl.shaderSource(fragment, BLEND_FRAGMENT_SHADER)
        gl.compileShader(fragment)
        if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
            console.error("[blend] shader:", gl.getShaderInfoLog(fragment))
            return false
        }
        gl.attachShader(program, vertex)
        gl.attachShader(program, fragment)
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
        this.program = program
        gl.useProgram(program)
        this.uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]))

        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
        const position = gl.getAttribLocation(program, "a")
        gl.enableVertexAttribArray(position)
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

        this.texture = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, this.texture)
        // linear: the canvas frame may be scaled slightly to the projector
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        return true
    }

    /** a captured frame of the whole canvas (synchronous: the buffer is reused after this returns) */
    drawFrame(frame: StreamFrame) {
        if (!this.ready()) return false
        if (frame.format === "uyvy") return false // capture is requested as RGBA/BGRA for blend groups
        const gl = this.gl!
        const data = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data)
        gl.bindTexture(gl.TEXTURE_2D, this.texture)
        const size = frame.xres + "x" + frame.yres
        if (this.textureSize === size) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frame.xres, frame.yres, gl.RGBA, gl.UNSIGNED_BYTE, data)
        else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frame.xres, frame.yres, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
            this.textureSize = size
        }
        this.render(true, frame.format === "bgra")
        return true
    }

    /** any DOM source showing the whole canvas: a video, canvas or image */
    drawSource(source: TexImageSource) {
        if (!this.ready()) return false
        const gl = this.gl!
        gl.bindTexture(gl.TEXTURE_2D, this.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
        this.textureSize = ""
        this.render(true, false)
        return true
    }

    /** patterns need no source */
    drawPattern() {
        if (!this.ready()) return false
        this.render(false, false)
        return true
    }

    destroy() {
        this.gl?.getExtension("WEBGL_lose_context")?.loseContext()
        this.gl = null
        this.program = null
        this.texture = null
        this.textureSize = ""
        this.canvas = null
    }

    private ready() {
        return !!(this.gl && this.program && this.canvas)
    }

    private render(hasSource: boolean, swapRB: boolean) {
        const gl = this.gl!
        const canvas = this.canvas!
        const cfg = this.config
        const slice = getSlices(cfg)[this.projector]
        const size = canvasSize(cfg)

        if (canvas.width !== slice.width || canvas.height !== slice.height) {
            canvas.width = slice.width
            canvas.height = slice.height
        }
        gl.viewport(0, 0, slice.width, slice.height)
        gl.useProgram(this.program)

        const u = this.uniforms
        gl.uniform1i(u.t, 0)
        gl.uniform1f(u.hasSource, hasSource ? 1 : 0)
        gl.uniform1f(u.swapRB, swapRB ? 1 : 0)
        gl.uniform2f(u.canvasSize, size.width, size.height)
        gl.uniform2f(u.sliceOrigin, slice.canvasX, slice.canvasY)
        gl.uniform2f(u.sliceSize, slice.width, slice.height)
        gl.uniform1f(u.leftOverlap, slice.leftOverlap)
        gl.uniform1f(u.rightOverlap, slice.rightOverlap)
        gl.uniform1f(u.gamma, cfg.gamma)
        gl.uniform1f(u.curve, CURVE_IDS[cfg.curve])
        gl.uniform1f(u.brightness, slice.brightness)
        gl.uniform1f(u.blackLevel, cfg.blackLevel)
        gl.uniform1f(u.blackFeather, cfg.blackFeather)
        gl.uniform1f(u.pattern, PATTERN_IDS[this.pattern])
        gl.uniform1f(u.projector, this.projector)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
}
