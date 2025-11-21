// Procedural Grass Vertex Shader

uniform float uTime;

// Varyings to pass data to the fragment shader
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vBladeHeight;

void main() {
    // --- BLADE GENERATION ---
    // We use the base plane's vertices and UVs to generate a blade shape.
    // A default PlaneGeometry in Three.js has position.y ranging from -0.5 to 0.5.
    // We remap this to a 0-1 range to use as a height factor.
    float heightFactor = position.y + 0.5;

    float bladeHeight = 0.8;
    float bladeWidth = 0.1;
    
    vec3 blade = vec3(position.x * bladeWidth, heightFactor * bladeHeight, 0.0);
    
    // --- WIND & CURVATURE ---
    // Wind effect using time and the instance ID to vary the animation
    float windStrength = 0.3;
    blade.x += sin(uTime * 2.0 + float(gl_InstanceID)) * windStrength * heightFactor;

    // Add a curve to the blade
    blade.x -= pow(heightFactor, 2.0) * 0.5;

    // --- FINAL TRANSFORM ---
    // Apply the instance matrix to position the blade in the world,
    // then apply the standard model-view and projection matrices.
    vec4 modelViewPosition = modelViewMatrix * instanceMatrix * vec4(blade, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;

    // --- VARYINGS ---
    // Pass corrected world position to the fragment shader for lighting and effects
    vWorldPosition = (modelMatrix * instanceMatrix * vec4(blade, 1.0)).xyz;
    
    // Pass other varyings
    vNormal = normal; // Note: This is an approximation (normal of the base plane)
    vBladeHeight = heightFactor;
}
