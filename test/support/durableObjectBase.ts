// Base-class shim for Node route tests only; storage/concurrency use workerd tests.
export class DurableObject {
  protected ctx: DurableObjectState;
  constructor(ctx: DurableObjectState) { this.ctx = ctx; }
}
