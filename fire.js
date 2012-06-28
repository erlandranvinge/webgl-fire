
var glUtils = {}; /* It's good to have old GLU back! :) */

/* Initialize WebGL and do a few basic settings */
glUtils.initGL = function(canvas, options) {
    options = options || {};
    if (!('alpha' in options))
        options.alpha = false;
    try {
        gl = canvas.getContext('webgl', options);
    } catch (e) { }
    try {
        gl = gl || canvas.getContext('experimental-webgl', options);
    } catch (e) { }
    if (!gl) {
        return null;
    }
    gl.width = options.width || canvas.width;
    gl.height = options.height || canvas.height;
    gl.viewport(0, 0, gl.width, gl.height);
    gl.clearColor(0.0, 0.0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);

    /* Register a tick function for animation */
    window.requestTick = function () {
        return (window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
            window.mozRequestAnimationFrame || window.oRequestAnimationFrame ||
            window.msRequestAnimationFrame ||
            function (/* function */callback) {
                window.setTimeout(callback, 1000 / 60); /* Fall back on ordinary timer */
            }
            );
    } ();

    return gl;
};

/* Create orthographic projection matrix, can be found either in MesaGL, glMatrix or any good book on the subject */
glUtils.ortho = function(a,b,c,d,e,g) { var f = new Float32Array(16); var h=b-a,i=d-c,j=g-e;
    f[0]=2/h; f[1]=0; f[2]=0; f[3]=0; f[4]=0; f[5]=2/i; f[6]=0; f[7]=0; f[8]=0; f[9]=0;
    f[10]=-2/j; f[11]=0; f[12]=-(a+b)/h; f[13]=-(d+c)/i; f[14]=-(g+e)/j; f[15]=1; return f;
};

/* Build a shader from either DOM-nodes or strings directly. */
glUtils.buildShader = function(vertex, fragment) {

    var v = document.getElementById(vertex) ?
        document.getElementById(vertex).firstChild.nodeValue : vertex;

    var f = document.getElementById(fragment) ?
        document.getElementById(fragment).firstChild.nodeValue : fragment;

    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, v);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS))
        console.log(gl.getShaderInfoLog(vs));

    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, f);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS))
        console.log(gl.getShaderInfoLog(fs));

    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        console.log(gl.getProgramInfoLog(program));

    /* Assume all shaders has a projection matrix, suffices for now, more sophisticated solutions enumerate uniforms,
       attributes and what not to perform auto-mapping. */
    program.projectionMatrix = gl.getUniformLocation(program, 'projectionMatrix');
    return program;
};

/* Builds a render target, i.e. a framebuffer with its renderbuffer and texture. */
glUtils.buildFrameBuffer = function(width, height) {
    var frameBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    frameBuffer.width = width;
    frameBuffer.height = height;

    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frameBuffer.width, frameBuffer.height,
        0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    var renderBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, frameBuffer.width, frameBuffer.height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderBuffer);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return {frameBuffer: frameBuffer, texture: texture};
};

/* Builds a simple 2D sprite as a vertex buffer */
glUtils.buildSprite = function(x, y, width, height) {
    var vertices = new Float32Array([
        x, y + height, 0.0, 1.0,
        x + width, y + height, 1.0, 1.0,
        x + width, y, 1.0, 0.0,
        x, y + height, 0.0, 1.0,
        x + width, y, 1.0, 0.0,
        x, y, 0.0, 0.0]);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    buffer.itemSize = 2;
    buffer.numItems = vertices.length / (2 * buffer.itemSize);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    return buffer;
};

/* Mask objects are rectangular geometry used to regenerate emitter rectangles and fill them with pseudo-random
   noise. */
var Mask = function(rectangles) {
    gl.bindTexture(gl.TEXTURE_2D, null);

    /* A simple shader randomizing content of pixels is used to produce emitter content */
    var program = glUtils.buildShader(
        'attribute vec2 vp; uniform mat4 pm; void main() { gl_Position = pm * vec4(vp, 0.0, 1.0); }',
        'precision mediump float; uniform float seed; ' +
        'float rnd(vec2 n) { return 0.5 + 0.5 * fract(sin(dot(n.xy, vec2(12.9898, 78.233)))* 43758.5453); }' +
        'void main() { gl_FragColor = vec4(rnd(gl_FragCoord.xy * seed), 0.0, 0.0, 1.0); }');
    var projectionMatrix =  glUtils.ortho(0, gl.width, 0, gl.height, -99999, 99999);

    /* Get uniforms, attributes and bind them to local properties on program object */
    gl.useProgram(program);
    program.projectionMatrix = gl.getUniformLocation(program, 'pm');
    program.vertexPosition = gl.getAttribLocation(program, 'vp');
    program.seed = gl.getUniformLocation(program, "seed");

    /* Tessellate rectangles into triangles */
    var vertices = new Float32Array(rectangles.length * 12);
    var offset = 0;
    for (var i = 0; i < rectangles.length; i++) {

        var rectangle = rectangles[i];
        vertices[offset++] = rectangle.x;
        vertices[offset++] = rectangle.y;
        vertices[offset++] = rectangle.x + rectangle.width;
        vertices[offset++] = rectangle.y;
        vertices[offset++] = rectangle.x + rectangle.width;
        vertices[offset++] = rectangle.y + rectangle.height;
        vertices[offset++] = rectangle.x + rectangle.width;
        vertices[offset++] = rectangle.y + rectangle.height;
        vertices[offset++] = rectangle.x;
        vertices[offset++] = rectangle.y + rectangle.height;
        vertices[offset++] = rectangle.x;
        vertices[offset++] = rectangle.y;
    }
    gl.uniformMatrix4fv(program.projectionMatrix, false, projectionMatrix);
    var buffer = gl.createBuffer();
    buffer.count = vertices.length / 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(program.vertexPosition);
    gl.useProgram(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.program = program;
    this.buffer = buffer;
};

/* Renders the mask using its shader */
Mask.prototype.render = function() {
    gl.useProgram(mask.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, mask.buffer);
    gl.vertexAttribPointer(mask.program.vertexPosition, 2, gl.FLOAT, false, 8, 0);
    gl.uniform1f(mask.program.seed, Math.random());
    gl.drawArrays(gl.TRIANGLES, 0, mask.buffer.count);
};
