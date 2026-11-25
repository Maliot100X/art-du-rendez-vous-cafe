function Rt(m,pe){let ee=!1,te=!0;const re=new IntersectionObserver(([a])=>{te=a.isIntersecting});re.observe(m);const ge=()=>te&&!document.hidden;function Se(){let a=D(m.clientWidth),F=D(m.clientHeight);return m.width!=a||m.height!=F?(m.width=a,m.height=F,!0):!1}function D(a){let F=window.devicePixelRatio||1;return Math.floor(a*F)}function De(a){const F=[[.94,.89,.78],[.73,.54,.24],[.6,.38,.18],[.96,.93,.87]];let Y=0;function ie(){this.id=-1,this.texcoordX=0,this.texcoordY=0,this.prevTexcoordX=0,this.prevTexcoordY=0,this.deltaX=0,this.deltaY=0,this.down=!1,this.moved=!1,this.color=[30,0,300]}let p=[],oe=[];p.push(new ie);const{gl:t,ext:E}=ye(m);_e()&&(a.DYE_RESOLUTION=512),E.supportLinearFiltering||(a.DYE_RESOLUTION=512,a.SHADING=!1,a.BLOOM=!1,a.SUNRAYS=!1);function ye(e){const i={alpha:!0,depth:!1,stencil:!1,antialias:!1,preserveDrawingBuffer:!1};let r=e.getContext("webgl2",i);const o=!!r;o||(r=e.getContext("webgl",i)||e.getContext("experimental-webgl",i));let n,l;o?(r.getExtension("EXT_color_buffer_float"),l=r.getExtension("OES_texture_float_linear")):(n=r.getExtension("OES_texture_half_float"),l=r.getExtension("OES_texture_half_float_linear")),r.clearColor(0,0,0,1);const u=o?r.HALF_FLOAT:n.HALF_FLOAT_OES;let f,s,S;return o?(f=y(r,r.RGBA16F,r.RGBA,u),s=y(r,r.RG16F,r.RG,u),S=y(r,r.R16F,r.RED,u)):(f=y(r,r.RGBA,r.RGBA,u),s=y(r,r.RGBA,r.RGBA,u),S=y(r,r.RGBA,r.RGBA,u)),{gl:r,ext:{formatRGBA:f,formatRG:s,formatR:S,halfFloatTexType:u,supportLinearFiltering:l}}}function y(e,i,r,o){if(!Ae(e,i,r,o))switch(i){case e.R16F:return y(e,e.RG16F,e.RG,o);case e.RG16F:return y(e,e.RGBA16F,e.RGBA,o);default:return null}return{internalFormat:i,format:r}}function Ae(e,i,r,o){let n=e.createTexture();e.bindTexture(e.TEXTURE_2D,n),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,i,4,4,0,r,o,null);let l=e.createFramebuffer();return e.bindFramebuffer(e.FRAMEBUFFER,l),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,n,0),e.checkFramebufferStatus(e.FRAMEBUFFER)==e.FRAMEBUFFER_COMPLETE}function _e(){return/Mobi|Android/i.test(navigator.userAgent)}class be{constructor(i,r){this.vertexShader=i,this.fragmentShaderSource=r,this.programs=[],this.activeProgram=null,this.uniforms=[]}setKeywords(i){let r=0;for(let n=0;n<i.length;n++)r+=Et(i[n]);let o=this.programs[r];if(o==null){let n=d(t.FRAGMENT_SHADER,this.fragmentShaderSource,i);o=ne(this.vertexShader,n),this.programs[r]=o}o!=this.activeProgram&&(this.uniforms=ae(o),this.activeProgram=o)}bind(){t.useProgram(this.activeProgram)}}class h{constructor(i,r){this.uniforms={},this.program=ne(i,r),this.uniforms=ae(this.program)}bind(){t.useProgram(this.program)}}function ne(e,i){let r=t.createProgram();return t.attachShader(r,e),t.attachShader(r,i),t.linkProgram(r),t.getProgramParameter(r,t.LINK_STATUS)||console.trace(t.getProgramInfoLog(r)),r}function ae(e){let i=[],r=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let o=0;o<r;o++){let n=t.getActiveUniform(e,o).name;i[n]=t.getUniformLocation(e,n)}return i}function d(e,i,r){i=Fe(i,r);const o=t.createShader(e);return t.shaderSource(o,i),t.compileShader(o),t.getShaderParameter(o,t.COMPILE_STATUS)||console.trace(t.getShaderInfoLog(o)),o}function Fe(e,i){if(i==null)return e;let r="";return i.forEach(o=>{r+="#define "+o+`
`}),r+e}const T=d(t.VERTEX_SHADER,`
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`),Ue=d(t.VERTEX_SHADER,`
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`),Le=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
    }
`),we=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`),Be=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
`),Pe=d(t.FRAGMENT_SHADER,`
    precision mediump float;

    uniform vec4 color;

    void main () {
        gl_FragColor = color;
    }
`),Ne=d(t.FRAGMENT_SHADER,`
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float aspectRatio;

    #define SCALE 25.0

    void main () {
        vec2 uv = floor(vUv * SCALE * vec2(aspectRatio, 1.0));
        float v = mod(uv.x + uv.y, 2.0);
        v = v * 0.1 + 0.8;
        gl_FragColor = vec4(vec3(v), 1.0);
    }
`),Oe=`
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform sampler2D uSunrays;
    uniform sampler2D uDithering;
    uniform vec2 ditherScale;
    uniform vec2 texelSize;

    vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
    }

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;

    #ifdef SHADING
        vec3 lc = texture2D(uTexture, vL).rgb;
        vec3 rc = texture2D(uTexture, vR).rgb;
        vec3 tc = texture2D(uTexture, vT).rgb;
        vec3 bc = texture2D(uTexture, vB).rgb;

        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);

        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);

        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    #endif

    #ifdef BLOOM
        vec3 bloom = texture2D(uBloom, vUv).rgb;
    #endif

    #ifdef SUNRAYS
        float sunrays = texture2D(uSunrays, vUv).r;
        c *= sunrays;
    #ifdef BLOOM
        bloom *= sunrays;
    #endif
    #endif

    #ifdef BLOOM
        float noise = texture2D(uDithering, vUv * ditherScale).r;
        noise = noise * 2.0 - 1.0;
        bloom += noise / 255.0;
        bloom = linearToGamma(bloom);
        c += bloom;
    #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
    }
`,Me=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
    }
`),Xe=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum;
    }
`),Ce=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum * intensity;
    }
`),Ie=d(t.FRAGMENT_SHADER,`
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        vec4 c = texture2D(uTexture, vUv);
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        gl_FragColor = c;
    }
`),ze=d(t.FRAGMENT_SHADER,`
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float weight;

    #define ITERATIONS 16

    void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;

        vec2 coord = vUv;
        vec2 dir = vUv - 0.5;

        dir *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;

        float color = texture2D(uTexture, vUv).a;

        for (int i = 0; i < ITERATIONS; i++)
        {
            coord -= dir;
            float col = texture2D(uTexture, coord).a;
            color += col * illuminationDecay * weight;
            illuminationDecay *= Decay;
        }

        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
    }
`),Ge=d(t.FRAGMENT_SHADER,`
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`),Ye=d(t.FRAGMENT_SHADER,`
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;

        vec2 iuv = floor(st);
        vec2 fuv = fract(st);

        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
    #ifdef MANUAL_FILTERING
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        vec4 result = bilerp(uSource, coord, dyeTexelSize);
    #else
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
    #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
    }`,E.supportLinearFiltering?null:["MANUAL_FILTERING"]),He=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;

        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }

        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`),Ve=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`),We=d(t.FRAGMENT_SHADER,`
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;

        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`),ke=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`),qe=d(t.FRAGMENT_SHADER,`
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`),v=(t.bindBuffer(t.ARRAY_BUFFER,t.createBuffer()),t.bufferData(t.ARRAY_BUFFER,new Float32Array([-1,-1,-1,1,1,1,1,-1]),t.STATIC_DRAW),t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,t.createBuffer()),t.bufferData(t.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),t.STATIC_DRAW),t.vertexAttribPointer(0,2,t.FLOAT,!1,0,0),t.enableVertexAttribArray(0),(e,i=!1)=>{e==null?(t.viewport(0,0,t.drawingBufferWidth,t.drawingBufferHeight),t.bindFramebuffer(t.FRAMEBUFFER,null)):(t.viewport(0,0,e.width,e.height),t.bindFramebuffer(t.FRAMEBUFFER,e.fbo)),i&&(t.clearColor(0,0,0,1),t.clear(t.COLOR_BUFFER_BIT)),t.drawElements(t.TRIANGLES,6,t.UNSIGNED_SHORT,0)});let x,c,H,V,A,W,U=[],N,ue,le=Qe("/art-du-rendez-vous-cafe/media/fluid/LDR_LLL1_0.png");const B=new h(Ue,Le),ce=new h(T,we),k=new h(T,Be),fe=new h(T,Pe),se=new h(T,Ne),O=new h(T,Me),P=new h(T,Xe),M=new h(T,Ce),me=new h(T,Ie),q=new h(T,ze),_=new h(T,Ge),R=new h(T,Ye),K=new h(T,He),j=new h(T,Ve),w=new h(T,We),X=new h(T,ke),C=new h(T,qe),b=new be(T,Oe);function ve(){let e=G(a.SIM_RESOLUTION),i=G(a.DYE_RESOLUTION);const r=E.halfFloatTexType,o=E.formatRGBA,n=E.formatRG,l=E.formatR,u=E.supportLinearFiltering?t.LINEAR:t.NEAREST;t.disable(t.BLEND),x==null?x=J(i.width,i.height,o.internalFormat,o.format,r,u):x=de(x,i.width,i.height,o.internalFormat,o.format,r,u),c==null?c=J(e.width,e.height,n.internalFormat,n.format,r,u):c=de(c,e.width,e.height,n.internalFormat,n.format,r,u),H=g(e.width,e.height,l.internalFormat,l.format,r,t.NEAREST),V=g(e.width,e.height,l.internalFormat,l.format,r,t.NEAREST),A=J(e.width,e.height,l.internalFormat,l.format,r,t.NEAREST),Ke(),je()}function Ke(){let e=G(a.BLOOM_RESOLUTION);const i=E.halfFloatTexType,r=E.formatRGBA,o=E.supportLinearFiltering?t.LINEAR:t.NEAREST;W=g(e.width,e.height,r.internalFormat,r.format,i,o),U.length=0;for(let n=0;n<a.BLOOM_ITERATIONS;n++){let l=e.width>>n+1,u=e.height>>n+1;if(l<2||u<2)break;let f=g(l,u,r.internalFormat,r.format,i,o);U.push(f)}}function je(){let e=G(a.SUNRAYS_RESOLUTION);const i=E.halfFloatTexType,r=E.formatR,o=E.supportLinearFiltering?t.LINEAR:t.NEAREST;N=g(e.width,e.height,r.internalFormat,r.format,i,o),ue=g(e.width,e.height,r.internalFormat,r.format,i,o)}function g(e,i,r,o,n,l){t.activeTexture(t.TEXTURE0);let u=t.createTexture();t.bindTexture(t.TEXTURE_2D,u),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,l),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,l),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texImage2D(t.TEXTURE_2D,0,r,e,i,0,o,n,null);let f=t.createFramebuffer();t.bindFramebuffer(t.FRAMEBUFFER,f),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,u,0),t.viewport(0,0,e,i),t.clear(t.COLOR_BUFFER_BIT);let s=1/e,S=1/i;return{texture:u,fbo:f,width:e,height:i,texelSizeX:s,texelSizeY:S,attach(L){return t.activeTexture(t.TEXTURE0+L),t.bindTexture(t.TEXTURE_2D,u),L}}}function J(e,i,r,o,n,l){let u=g(e,i,r,o,n,l),f=g(e,i,r,o,n,l);return{width:e,height:i,texelSizeX:u.texelSizeX,texelSizeY:u.texelSizeY,get read(){return u},set read(s){u=s},get write(){return f},set write(s){f=s},swap(){let s=u;u=f,f=s}}}function Je(e,i,r,o,n,l,u){let f=g(i,r,o,n,l,u);return ce.bind(),t.uniform1i(ce.uniforms.uTexture,e.attach(0)),v(f),f}function de(e,i,r,o,n,l,u){return e.width==i&&e.height==r||(e.read=Je(e.read,i,r,o,n,l,u),e.write=g(i,r,o,n,l,u),e.width=i,e.height=r,e.texelSizeX=1/i,e.texelSizeY=1/r),e}function Qe(e){let i=t.createTexture();t.bindTexture(t.TEXTURE_2D,i),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.REPEAT),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.REPEAT),t.texImage2D(t.TEXTURE_2D,0,t.RGB,1,1,0,t.RGB,t.UNSIGNED_BYTE,new Uint8Array([255,255,255]));let r={texture:i,width:1,height:1,attach(n){return t.activeTexture(t.TEXTURE0+n),t.bindTexture(t.TEXTURE_2D,i),n}},o=new Image;return o.onload=()=>{r.width=o.width,r.height=o.height,t.bindTexture(t.TEXTURE_2D,i),t.texImage2D(t.TEXTURE_2D,0,t.RGB,t.RGB,t.UNSIGNED_BYTE,o)},o.src=e,r}function Ze(){let e=[];a.SHADING&&e.push("SHADING"),a.BLOOM&&e.push("BLOOM"),a.SUNRAYS&&e.push("SUNRAYS"),b.setKeywords(e)}Ze(),ve(),he(parseInt(Math.random()*20)+5);let Q=Date.now(),I=0;Z();function Z(){if(ee)return;if(!ge()){Q=Date.now(),requestAnimationFrame(Z);return}const e=$e();if(Y-=e,Y<=0){Y=.9+Math.random()*.9;const i=z();$(.25+Math.random()*.5,.98,(Math.random()-.5)*300,-700-Math.random()*400,{r:i.r*4,g:i.g*4,b:i.b*4})}Se()&&ve(),et(e),tt(),a.PAUSED||rt(e),it(null),requestAnimationFrame(Z)}function $e(){let e=Date.now(),i=(e-Q)/1e3;return i=Math.min(i,.016666),Q=e,i}function et(e){a.COLORFUL&&(I+=e*a.COLOR_UPDATE_SPEED,I>=1&&(I=Tt(I,0,1),p.forEach(i=>{i.color=z()})))}function tt(){oe.length>0&&he(oe.pop()),p.forEach(e=>{e.moved&&(e.moved=!1,ft(e))})}function rt(e){t.disable(t.BLEND),j.bind(),t.uniform2f(j.uniforms.texelSize,c.texelSizeX,c.texelSizeY),t.uniform1i(j.uniforms.uVelocity,c.read.attach(0)),v(V),w.bind(),t.uniform2f(w.uniforms.texelSize,c.texelSizeX,c.texelSizeY),t.uniform1i(w.uniforms.uVelocity,c.read.attach(0)),t.uniform1i(w.uniforms.uCurl,V.attach(1)),t.uniform1f(w.uniforms.curl,a.CURL),t.uniform1f(w.uniforms.dt,e),v(c.write),c.swap(),K.bind(),t.uniform2f(K.uniforms.texelSize,c.texelSizeX,c.texelSizeY),t.uniform1i(K.uniforms.uVelocity,c.read.attach(0)),v(H),k.bind(),t.uniform1i(k.uniforms.uTexture,A.read.attach(0)),t.uniform1f(k.uniforms.value,a.PRESSURE),v(A.write),A.swap(),X.bind(),t.uniform2f(X.uniforms.texelSize,c.texelSizeX,c.texelSizeY),t.uniform1i(X.uniforms.uDivergence,H.attach(0));for(let r=0;r<a.PRESSURE_ITERATIONS;r++)t.uniform1i(X.uniforms.uPressure,A.read.attach(1)),v(A.write),A.swap();C.bind(),t.uniform2f(C.uniforms.texelSize,c.texelSizeX,c.texelSizeY),t.uniform1i(C.uniforms.uPressure,A.read.attach(0)),t.uniform1i(C.uniforms.uVelocity,c.read.attach(1)),v(c.write),c.swap(),R.bind(),t.uniform2f(R.uniforms.texelSize,c.texelSizeX,c.texelSizeY),E.supportLinearFiltering||t.uniform2f(R.uniforms.dyeTexelSize,c.texelSizeX,c.texelSizeY);let i=c.read.attach(0);t.uniform1i(R.uniforms.uVelocity,i),t.uniform1i(R.uniforms.uSource,i),t.uniform1f(R.uniforms.dt,e),t.uniform1f(R.uniforms.dissipation,a.VELOCITY_DISSIPATION),v(c.write),c.swap(),E.supportLinearFiltering||t.uniform2f(R.uniforms.dyeTexelSize,x.texelSizeX,x.texelSizeY),t.uniform1i(R.uniforms.uVelocity,c.read.attach(0)),t.uniform1i(R.uniforms.uSource,x.read.attach(1)),t.uniform1f(R.uniforms.dissipation,a.DENSITY_DISSIPATION),v(x.write),x.swap()}function it(e){a.BLOOM&&ut(x.read,W),a.SUNRAYS&&(lt(x.read,x.write,N),ct(N,ue,1)),t.blendFunc(t.ONE,t.ONE_MINUS_SRC_ALPHA),t.enable(t.BLEND),a.TRANSPARENT||ot(e,ht(a.BACK_COLOR)),a.TRANSPARENT&&nt(e),at(e)}function ot(e,i){fe.bind(),t.uniform4f(fe.uniforms.color,i.r,i.g,i.b,1),v(e)}function nt(e){se.bind(),t.uniform1f(se.uniforms.aspectRatio,m.width/m.height),v(e)}function at(e){let i=t.drawingBufferWidth,r=t.drawingBufferHeight;if(b.bind(),a.SHADING&&t.uniform2f(b.uniforms.texelSize,1/i,1/r),t.uniform1i(b.uniforms.uTexture,x.read.attach(0)),a.BLOOM){t.uniform1i(b.uniforms.uBloom,W.attach(1)),t.uniform1i(b.uniforms.uDithering,le.attach(2));let o=xt(le,i,r);t.uniform2f(b.uniforms.ditherScale,o.x,o.y)}a.SUNRAYS&&t.uniform1i(b.uniforms.uSunrays,N.attach(3)),v(e)}function ut(e,i){if(U.length<2)return;let r=i;t.disable(t.BLEND),O.bind();let o=a.BLOOM_THRESHOLD*a.BLOOM_SOFT_KNEE+1e-4,n=a.BLOOM_THRESHOLD-o,l=o*2,u=.25/o;t.uniform3f(O.uniforms.curve,n,l,u),t.uniform1f(O.uniforms.threshold,a.BLOOM_THRESHOLD),t.uniform1i(O.uniforms.uTexture,e.attach(0)),v(r),P.bind();for(let f=0;f<U.length;f++){let s=U[f];t.uniform2f(P.uniforms.texelSize,r.texelSizeX,r.texelSizeY),t.uniform1i(P.uniforms.uTexture,r.attach(0)),v(s),r=s}t.blendFunc(t.ONE,t.ONE),t.enable(t.BLEND);for(let f=U.length-2;f>=0;f--){let s=U[f];t.uniform2f(P.uniforms.texelSize,r.texelSizeX,r.texelSizeY),t.uniform1i(P.uniforms.uTexture,r.attach(0)),t.viewport(0,0,s.width,s.height),v(s),r=s}t.disable(t.BLEND),M.bind(),t.uniform2f(M.uniforms.texelSize,r.texelSizeX,r.texelSizeY),t.uniform1i(M.uniforms.uTexture,r.attach(0)),t.uniform1f(M.uniforms.intensity,a.BLOOM_INTENSITY),v(i)}function lt(e,i,r){t.disable(t.BLEND),me.bind(),t.uniform1i(me.uniforms.uTexture,e.attach(0)),v(i),q.bind(),t.uniform1f(q.uniforms.weight,a.SUNRAYS_WEIGHT),t.uniform1i(q.uniforms.uTexture,i.attach(0)),v(r)}function ct(e,i,r){B.bind();for(let o=0;o<r;o++)t.uniform2f(B.uniforms.texelSize,e.texelSizeX,0),t.uniform1i(B.uniforms.uTexture,e.attach(0)),v(i),t.uniform2f(B.uniforms.texelSize,0,e.texelSizeY),t.uniform1i(B.uniforms.uTexture,i.attach(0)),v(e)}function ft(e){let i=e.deltaX*a.SPLAT_FORCE,r=e.deltaY*a.SPLAT_FORCE;$(e.texcoordX,e.texcoordY,i,r,e.color)}function he(e){for(let i=0;i<e;i++){const r=z();r.r*=10,r.g*=10,r.b*=10;const o=Math.random(),n=Math.random(),l=1e3*(Math.random()-.5),u=1e3*(Math.random()-.5);$(o,n,l,u,r)}}function $(e,i,r,o,n){_.bind(),t.uniform1i(_.uniforms.uTarget,c.read.attach(0)),t.uniform1f(_.uniforms.aspectRatio,m.width/m.height),t.uniform2f(_.uniforms.point,e,i),t.uniform3f(_.uniforms.color,r,o,0),t.uniform1f(_.uniforms.radius,st(a.SPLAT_RADIUS/100)),v(c.write),c.swap(),t.uniform1i(_.uniforms.uTarget,x.read.attach(0)),t.uniform3f(_.uniforms.color,n.r,n.g,n.b),v(x.write),x.swap()}function st(e){let i=m.width/m.height;return i>1&&(e*=i),e}const mt=e=>{const i=m.getBoundingClientRect();if(e.clientY<i.top||e.clientY>i.bottom||e.clientX<i.left||e.clientX>i.right)return;let r=p[0],o=D(e.clientX-i.left),n=D(e.clientY-i.top);r.down||Te(r,-1,o,n),xe(r,o,n)};window.addEventListener("mousemove",mt),window.addEventListener("mouseup",()=>{Ee(p[0])}),m.addEventListener("touchstart",e=>{const i=e.targetTouches;for(;i.length>=p.length;)p.push(new ie);for(let r=0;r<i.length;r++){let o=D(i[r].pageX),n=D(i[r].pageY);Te(p[r+1],i[r].identifier,o,n)}}),m.addEventListener("touchmove",e=>{const i=e.targetTouches;for(let r=0;r<i.length;r++){let o=p[r+1];if(!o.down)continue;let n=D(i[r].pageX),l=D(i[r].pageY);xe(o,n,l)}},!1),window.addEventListener("touchend",e=>{const i=e.changedTouches;for(let r=0;r<i.length;r++){let o=p.find(n=>n.id==i[r].identifier);o!=null&&Ee(o)}});function Te(e,i,r,o){e.id=i,e.down=!0,e.moved=!1,e.texcoordX=r/m.width,e.texcoordY=1-o/m.height,e.prevTexcoordX=e.texcoordX,e.prevTexcoordY=e.texcoordY,e.deltaX=0,e.deltaY=0,e.color=z()}function xe(e,i,r){e.prevTexcoordX=e.texcoordX,e.prevTexcoordY=e.texcoordY,e.texcoordX=i/m.width,e.texcoordY=1-r/m.height,e.deltaX=vt(e.texcoordX-e.prevTexcoordX),e.deltaY=dt(e.texcoordY-e.prevTexcoordY),e.moved=Math.abs(e.deltaX)>0||Math.abs(e.deltaY)>0}function Ee(e){e.down=!1}function vt(e){let i=m.width/m.height;return i<1&&(e*=i),e}function dt(e){let i=m.width/m.height;return i>1&&(e/=i),e}function z(){if(a.CAFE_PALETTE){const e=F[Math.floor(Math.random()*F.length)];return{r:e[0]*.15,g:e[1]*.15,b:e[2]*.15}}if(a.RANDOM_COLORS){let e=Re(Math.random(),1,1);return e.r*=.15,e.g*=.15,e.b*=.15,e}else{let e=Re(a.SPLAT_HUE,1,1);return e.r*=.15,e.g*=.15,e.b*=.15,e}}function Re(e,i,r){let o,n,l,u,f,s,S,L;switch(u=Math.floor(e*6),f=e*6-u,s=r*(1-i),S=r*(1-f*i),L=r*(1-(1-f)*i),u%6){case 0:o=r,n=L,l=s;break;case 1:o=S,n=r,l=s;break;case 2:o=s,n=r,l=L;break;case 3:o=s,n=S,l=r;break;case 4:o=L,n=s,l=r;break;case 5:o=r,n=s,l=S;break}return{r:o,g:n,b:l}}function ht(e){return{r:e.r/255,g:e.g/255,b:e.b/255}}function Tt(e,i,r){let o=r-i;return(e-i)%o+i}function G(e){let i=t.drawingBufferWidth/t.drawingBufferHeight;i<1&&(i=1/i);let r=Math.round(e),o=Math.round(e*i);return t.drawingBufferWidth>t.drawingBufferHeight?{width:o,height:r}:{width:r,height:o}}function xt(e,i,r){return{x:i/e.width,y:r/e.height}}function Et(e){if(e.length==0)return 0;let i=0;for(let r=0;r<e.length;r++)i=(i<<5)-i+e.charCodeAt(r),i|=0;return i}}return De(pe),()=>{ee=!0,re.disconnect()}}export{Rt as startFluid};
