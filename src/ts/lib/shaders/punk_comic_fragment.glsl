uniform vec3 color;
uniform vec3 lightDirection;
uniform vec2 resolution;

varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vViewPosition;

void main() {
    // Normalize inputs
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(lightDirection);

    // Calculate diffuse lighting
    float diffuse = max(dot(normal, lightDir), 0.0);

    // Define hatching levels based on diffuse light
    float hatchingLevel = 0.0;
    if (diffuse > 0.9) {
        hatchingLevel = 0.0; // Brightest areas, no hatching
    } else if (diffuse > 0.7) {
        hatchingLevel = 0.2; // Light hatching
    } else if (diffuse > 0.5) {
        hatchingLevel = 0.4; // Medium hatching
    } else if (diffuse > 0.3) {
        hatchingLevel = 0.6; // Dense hatching
    } else {
        hatchingLevel = 0.8; // Darkest areas, very dense hatching
    }

    // Hatching pattern (simple diagonal lines)
    vec2 screenUV = gl_FragCoord.xy / resolution;
    float pattern = mod(screenUV.x * 50.0 + screenUV.y * 50.0, 1.0); // Diagonal lines

    vec3 finalColor = color;

    if (pattern < hatchingLevel) {
        finalColor = vec3(0.0); // Black lines
    }

    gl_FragColor = vec4(finalColor, 1.0);
}
