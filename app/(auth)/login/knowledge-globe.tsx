'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useMemo, useRef } from 'react';


// ============================================================
// TYPES
// ============================================================

type Point = {
  position: [number, number, number];
};


// ============================================================
// CREATE SPHERE POINTS
// ============================================================

function createPoints(count: number, radius: number): Point[] {
  const points: Point[] = [];

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;

    const radiusAtY = Math.sqrt(1 - y * y);

    const theta = goldenAngle * i;

    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;

    points.push({
      position: [
        x * radius,
        y * radius,
        z * radius,
      ],
    });
  }

  return points;
}


// ============================================================
// NETWORK LINES
// ============================================================

function NetworkLines({
  points,
}: {
  points: Point[];
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [];

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = new THREE.Vector3(
          ...points[i].position
        );

        const b = new THREE.Vector3(
          ...points[j].position
        );

        const distance = a.distanceTo(b);

        if (distance < 0.85) {
          positions.push(
            a.x,
            a.y,
            a.z,
            b.x,
            b.y,
            b.z
          );
        }
      }
    }

    const buffer =
      new THREE.BufferGeometry();

    buffer.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        positions,
        3
      )
    );

    return buffer;
  }, [points]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        color="#d6b98c"
        transparent
        opacity={0.16}
      />
    </lineSegments>
  );
}


// ============================================================
// SPHERE NODES
// ============================================================

function NetworkNodes({
  points,
}: {
  points: Point[];
}) {
  const group =
    useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;

    const time =
      clock.getElapsedTime();

    group.current.children.forEach(
      (child, index) => {
        const mesh =
          child as THREE.Mesh;

        const material =
          mesh.material as THREE.MeshBasicMaterial;

        material.opacity =
          0.35 +
          Math.sin(
            time * 1.4 + index * 0.4
          ) *
            0.18;
      }
    );
  });

  return (
    <group ref={group}>
      {points.map((point, index) => (
        <mesh
          key={index}
          position={point.position}
        >
          <sphereGeometry
            args={[
              index % 8 === 0
                ? 0.055
                : 0.028,
              8,
              8,
            ]}
          />

          <meshBasicMaterial
            color={
              index % 8 === 0
                ? '#e0bd82'
                : '#eee8dc'
            }
            transparent
            opacity={0.65}
          />
        </mesh>
      ))}
    </group>
  );
}


// ============================================================
// ORBIT RING
// ============================================================

function OrbitRing({
  rotation,
  scale,
}: {
  rotation: [number, number, number];
  scale: number;
}) {
  const ring =
    useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ring.current) return;

    ring.current.rotation.z =
      clock.getElapsedTime() * 0.08;
  });

  return (
    <mesh
      ref={ring}
      rotation={rotation}
      scale={scale}
    >
      <torusGeometry
        args={[
          2.65,
          0.009,
          8,
          180,
        ]}
      />

      <meshBasicMaterial
        color="#d6b98c"
        transparent
        opacity={0.32}
      />
    </mesh>
  );
}


// ============================================================
// CENTRAL MUJ CORE
// ============================================================

function MUJCore() {
  const core =
    useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!core.current) return;

    const time =
      clock.getElapsedTime();

    const scale =
      1 +
      Math.sin(time * 1.5) *
        0.035;

    core.current.scale.setScalar(
      scale
    );
  });

  return (
    <group>

      {/* Outer glow */}
      <mesh ref={core}>
        <sphereGeometry
          args={[
            0.75,
            32,
            32,
          ]}
        />

        <meshBasicMaterial
          color="#c89f65"
          transparent
          opacity={0.10}
        />
      </mesh>


      {/* Inner core */}
      <mesh>
        <sphereGeometry
          args={[
            0.48,
            32,
            32,
          ]}
        />

        <meshBasicMaterial
          color="#12100d"
        />
      </mesh>


      {/* MUJ Text */}
      <Html
        center
        position={[0, 0, 0.55]}
        distanceFactor={6}
      >
        <div className="pointer-events-none select-none text-center">

          <div className="font-serif text-[25px] tracking-[0.15em] text-[#f5f1e9]">
            MUJ
          </div>

          <div className="mt-1 font-mono text-[7px] uppercase tracking-[0.35em] text-[#d6b98c]">
            Jaipur
          </div>

        </div>
      </Html>

    </group>
  );
}


// ============================================================
// LABEL
// ============================================================

function NetworkLabel({
  text,
  position,
}: {
  text: string;
  position: [number, number, number];
}) {
  return (
    <Html
      position={position}
      center
      distanceFactor={7}
    >
      <div className="pointer-events-none whitespace-nowrap rounded-full border border-white/10 bg-[#101010]/90 px-4 py-2 font-mono text-[8px] uppercase tracking-[0.2em] text-white/60 backdrop-blur-md">

        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#d6b98c]" />

        {text}

      </div>
    </Html>
  );
}


// ============================================================
// MAIN KNOWLEDGE NETWORK
// ============================================================

function KnowledgeNetwork() {
  const points = useMemo(
    () => createPoints(190, 2.45),
    []
  );

  const group =
    useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!group.current) return;

    group.current.rotation.y +=
      delta * 0.045;

    group.current.rotation.x =
      Math.sin(
        Date.now() * 0.00015
      ) * 0.08;
  });

  return (
    <group ref={group}>

      {/* Network */}
      <NetworkLines
        points={points}
      />

      {/* Nodes */}
      <NetworkNodes
        points={points}
      />


      {/* Orbit rings */}

      <OrbitRing
        rotation={[
          Math.PI / 2.7,
          0.25,
          0,
        ]}
        scale={1}
      />

      <OrbitRing
        rotation={[
          Math.PI / 2,
          0,
          Math.PI / 3,
        ]}
        scale={0.86}
      />

      <OrbitRing
        rotation={[
          Math.PI / 3,
          Math.PI / 5,
          0,
        ]}
        scale={1.08}
      />


      {/* Center */}
      <MUJCore />


      {/* Labels */}

      <NetworkLabel
        text="Faculty"
        position={[
          -2.8,
          1.0,
          0.4,
        ]}
      />

      <NetworkLabel
        text="Research"
        position={[
          1.9,
          2.2,
          0,
        ]}
      />

      <NetworkLabel
        text="Departments"
        position={[
          2.9,
          -0.3,
          0.2,
        ]}
      />

      <NetworkLabel
        text="Publications"
        position={[
          -1.9,
          -2.2,
          0,
        ]}
      />

      <NetworkLabel
        text="Students"
        position={[
          1.6,
          -2.0,
          0.3,
        ]}
      />

    </group>
  );
}


// ============================================================
// BACKGROUND PARTICLES
// ============================================================

function BackgroundParticles() {
  const particles = useMemo(() => {
    const result: Array<{ position: [number, number, number]; size: number }> = [];

    for (let i = 0; i < 180; i++) {
      const p1 = Math.abs(Math.sin(i * 12.9898 + 78.233));
      const p2 = Math.abs(Math.sin(i * 37.719 + 11.233));
      const p3 = Math.abs(Math.sin(i * 59.131 + 43.811));
      const p4 = Math.abs(Math.sin(i * 91.241 + 19.513));

      result.push({
        position: [
          (p1 - 0.5) * 10,
          (p2 - 0.5) * 8,
          (p3 - 0.5) * 5,
        ],
        size: 0.006 + p4 * 0.008,
      });
    }

    return result;
  }, []);

  return (
    <group>
      {particles.map((particle, index) => (
        <mesh key={index} position={particle.position}>
          <sphereGeometry args={[particle.size, 6, 6]} />
          <meshBasicMaterial color="#d6b98c" transparent opacity={0.25} />
        </mesh>
      ))}
    </group>
  );
}


// ============================================================
// MAIN COMPONENT
// ============================================================

export default function KnowledgeGlobe() {
  return (
    <div className="absolute inset-0">

      <Canvas
        dpr={[1, 2]}
        camera={{
          position: [
            0,
            0,
            7.2,
          ],
          fov: 42,
        }}
        gl={{
          antialias: true,
          alpha: true,
        }}
      >

        <ambientLight
          intensity={0.5}
        />

        <BackgroundParticles />

        <KnowledgeNetwork />

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          rotateSpeed={0.4}
          minPolarAngle={
            Math.PI / 2.4
          }
          maxPolarAngle={
            Math.PI / 1.7
          }
        />

      </Canvas>

    </div>
  );
}