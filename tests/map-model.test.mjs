import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('every supported floor has a self-contained 3D mesh, without raster-plan textures', async()=>{
  for(const floor of [1,2,5,6,7]) {
    const bytes=await readFile(new URL(`../public/map/models/f${floor}.glb`,import.meta.url));
    assert.equal(bytes.readUInt32LE(0),0x46546c67);
    assert.equal(bytes.readUInt32LE(4),2);
    assert.equal(bytes.readUInt32LE(8),bytes.length);
    const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    assert(!json.images?.length && !json.textures?.length,'architecture must be actual geometry');
    for(const material of ['wall','floor','stair','lift']) assert(json.materials.some(m=>m.name===material));
    assert(json.meshes.length>=10 && json.meshes.length<20,'geometry is batched for mobile rendering');
    for(const mesh of json.meshes) for(const p of mesh.primitives) {
      const a=json.accessors[p.attributes.POSITION];
      assert(a.count>0);
      assert([...a.min,...a.max].every(Number.isFinite));
    }
  }
});
