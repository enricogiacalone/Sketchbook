import * as CANNON from "cannon-es";
import * as THREE from "three";

var PI_2 = Math.PI / 2;

var Type = {
  BOX: "Box",
  CYLINDER: "Cylinder",
  SPHERE: "Sphere",
  HULL: "ConvexPolyhedron",
  MESH: "Trimesh",
};

/**
 * Given a THREE.Object3D instance, creates a corresponding CANNON shape.
 * @param  {THREE.Object3D} object
 * @return {CANNON.Shape}
 */
export const threeToCannon = function (object, options) {
  options = options || {};

  var geometry;

  if (options.type === Type.BOX) {
    return createBoundingBoxShape(object);
  } else if (options.type === Type.CYLINDER) {
    return createBoundingCylinderShape(object, options);
  } else if (options.type === Type.SPHERE) {
    return createBoundingSphereShape(object, options);
  } else if (options.type === Type.HULL) {
    return createConvexPolyhedron(object);
  } else if (options.type === Type.MESH) {
    return createTrimeshShape(object);
  } else if (options.type) {
    throw new Error('[CANNON.threeToCannon] Invalid type "%s".', options.type);
  }

  geometry = getGeometry(object);
  if (!geometry) return null;

  var type = geometry.metadata ? geometry.metadata.type : geometry.type;

  switch (type) {
    case "BoxGeometry":
    case "BoxBufferGeometry":
      return createBoxShape(geometry);
    case "CylinderGeometry":
    case "CylinderBufferGeometry":
      return createCylinderShape(geometry);
    case "PlaneGeometry":
    case "PlaneBufferGeometry":
      return createPlaneShape(geometry);
    case "SphereGeometry":
    case "SphereBufferGeometry":
      return createSphereShape(geometry);
    case "TubeGeometry":
    case "Geometry":
    case "BufferGeometry":
      return createBoundingBoxShape(object);
    default:
      console.warn(
        'Unrecognized geometry: "%s". Using bounding box as shape.',
        geometry.type
      );
      return createBoxShape(geometry);
  }
};

threeToCannon.Type = Type;

/******************************************************************************
 * Shape construction
 */

/**
 * @return {CANNON.Shape}
 */
function createBoxShape(geometry) {
  var vertices = getVertices(geometry);

  if (!vertices.length) return null;

  geometry.computeBoundingBox();
  var box = geometry.boundingBox;
  return new CANNON.Box(
    new CANNON.Vec3(
      (box.max.x - box.min.x) / 2,
      (box.max.y - box.min.y) / 2,
      (box.max.z - box.min.z) / 2
    )
  );
}

/**
 * Bounding box needs to be computed with the entire mesh, not just geometry.
 * @param  {THREE.Object3D} mesh
 * @return {CANNON.Shape}
 */
function createBoundingBoxShape(object) {
  var shape,
    localPosition,
    box = new THREE.Box3();

  var clone = object.clone();
  clone.quaternion.set(0, 0, 0, 1);
  clone.updateMatrixWorld();

  box.setFromObject(clone);

  if (!isFinite(box.min.lengthSq())) return null;

  shape = new CANNON.Box(
    new CANNON.Vec3(
      (box.max.x - box.min.x) / 2,
      (box.max.y - box.min.y) / 2,
      (box.max.z - box.min.z) / 2
    )
  );

  localPosition = box
    .translate(clone.position.negate())
    .getCenter(new THREE.Vector3());
  if (localPosition.lengthSq()) {
    shape.offset = localPosition;
  }

  return shape;
}

/**
 * Computes 3D convex hull as a CANNON.ConvexPolyhedron.
 * @param  {THREE.Object3D} mesh
 * @return {CANNON.Shape}
 */
function createConvexPolyhedron(object) {
  console.warn(
    "[three-to-cannon] createConvexPolyhedron is not supported with BufferGeometry in this version."
  );
  return null;
}

/**
 * @return {CANNON.Shape}
 */
function createCylinderShape(geometry) {
  var shape,
    params = geometry.metadata
      ? geometry.metadata.parameters
      : geometry.parameters;
  shape = new CANNON.Cylinder(
    params.radiusTop,
    params.radiusBottom,
    params.height,
    params.radialSegments
  );

  // Include metadata for serialization.
  shape._type = CANNON.Shape.types.CYLINDER; // Patch schteppe/cannon.js#329.
  shape.radiusTop = params.radiusTop;
  shape.radiusBottom = params.radiusBottom;
  shape.height = params.height;
  shape.numSegments = params.radialSegments;

  shape.orientation = new CANNON.Quaternion();
  shape.orientation
    .setFromEuler(THREE.MathUtils.degToRad(90), 0, 0, "XYZ")
    .normalize();
  return shape;
}

/**
 * @param  {THREE.Object3D} object
 * @return {CANNON.Shape}
 */
function createBoundingCylinderShape(object, options) {
  var shape,
    height,
    radius,
    box = new THREE.Box3(),
    axes = ["x", "y", "z"],
    majorAxis = options.cylinderAxis || "y",
    minorAxes = axes.splice(axes.indexOf(majorAxis), 1) && axes;

  box.setFromObject(object);

  if (!isFinite(box.min.lengthSq())) return null;

  // Compute cylinder dimensions.
  height = box.max[majorAxis] - box.min[majorAxis];
  radius =
    0.5 *
    Math.max(
      box.max[minorAxes[0]] - box.min[minorAxes[0]],
      box.max[minorAxes[1]] - box.min[minorAxes[1]]
    );

  // Create shape.
  shape = new CANNON.Cylinder(radius, radius, height, 12);

  // Include metadata for serialization.
  shape._type = CANNON.Shape.types.CYLINDER; // Patch schteppe/cannon.js#329.
  shape.radiusTop = radius;
  shape.radiusBottom = radius;
  shape.height = height;
  shape.numSegments = 12;

  shape.orientation = new CANNON.Quaternion();
  shape.orientation
    .setFromEuler(
      majorAxis === "y" ? PI_2 : 0,
      majorAxis === "z" ? PI_2 : 0,
      0,
      "XYZ"
    )
    .normalize();
  return shape;
}

/**
 * @return {CANNON.Shape}
 */
function createPlaneShape(geometry) {
  geometry.computeBoundingBox();
  var box = geometry.boundingBox;
  return new CANNON.Box(
    new CANNON.Vec3(
      (box.max.x - box.min.x) / 2 || 0.1,
      (box.max.y - box.min.y) / 2 || 0.1,
      (box.max.z - box.min.z) / 2 || 0.1
    )
  );
}

/**
 * @return {CANNON.Shape}
 */
function createSphereShape(geometry) {
  var params = geometry.metadata
    ? geometry.metadata.parameters
    : geometry.parameters;
  return new CANNON.Sphere(params.radius);
}

/**
 * @param  {THREE.Object3D} object
 * @return {CANNON.Shape}
 */
function createBoundingSphereShape(object, options) {
  if (options.sphereRadius) {
    return new CANNON.Sphere(options.sphereRadius);
  }
  var geometry = getGeometry(object);
  if (!geometry) return null;
  geometry.computeBoundingSphere();
  return new CANNON.Sphere(geometry.boundingSphere.radius);
}

/**
 * @return {CANNON.Shape}
 */
function createTrimeshShape(object) {
  var geometry = getGeometry(object);

  if (!geometry) {
    return null;
  }

  var vertices = getVertices(geometry);
  var indices = [];

  if (geometry.index) {
    indices = Array.prototype.slice.call(geometry.index.array, 0);
  } else {
    for (var i = 0; i < vertices.length / 3; i++) {
      indices.push(i);
    }
  }

  return new CANNON.Trimesh(vertices, indices);
}

/******************************************************************************
 * Utils
 */

/**
 * Returns a single geometry for the given object. If the object is compound,
 * its geometries are automatically merged.
 * @param {THREE.Object3D} object
 */
function getGeometry(object) {
  var meshes = getMeshes(object);
  if (meshes.length === 0) return null;

  if (meshes.length > 1) {
    console.warn(
      "[three-to-cannon] Found multiple meshes in one object. Using only the first mesh."
    );
  }

  var mesh = meshes[0];
  mesh.updateMatrixWorld();

  var geometry = mesh.geometry.clone();

  var position = new THREE.Vector3();
  var quaternion = new THREE.Quaternion();
  var scale = new THREE.Vector3();
  mesh.matrixWorld.decompose(position, quaternion, scale);
  geometry.scale(scale.x, scale.y, scale.z);

  return geometry;
}

/**
 * @return {Array<number>}
 */
function getVertices(geometry) {
  if (!geometry.isBufferGeometry) {
    console.warn(
      "[three-to-cannon] Geometry is not a BufferGeometry. Cannot get vertices."
    );
    return [];
  }
  var position = geometry.attributes.position;
  if (!position) {
    console.warn(
      "[three-to-cannon] Geometry has no position attribute. Cannot get vertices."
    );
    return [];
  }
  return position.array;
}

/**
 * Returns a flat array of THREE.Mesh instances from the given object. If
 * nested transformations are found, they are applied to child meshes
 * as mesh.userData.matrix, so that each mesh has its position/rotation/scale
 * independently of all of its parents except the top-level object.
 * @param  {THREE.Object3D} object
 * @return {Array<THREE.Mesh>}
 */
function getMeshes(object) {
  var meshes = [];
  object.traverse(function (o) {
    if (o.type === "Mesh") {
      meshes.push(o);
    }
  });
  return meshes;
}
