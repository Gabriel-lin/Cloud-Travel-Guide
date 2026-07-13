/**
 * TSL 节点类型别名(@types/three 0.184 的 `Node<'vec3'>` 泛型携带 swizzle/运算符)。
 */

import type { Node, StorageBufferNode } from "three/webgpu";

export type NF = Node<"float">;
export type NI = Node<"int">;
export type NU = Node<"uint">;
export type NB = Node<"bool">;
export type NV2 = Node<"vec2">;
export type NV3 = Node<"vec3">;
export type NV4 = Node<"vec4">;

export type FloatBuffer = StorageBufferNode<"float">;

/** float 槽位可接受的输入 */
export type F = NF | number;
