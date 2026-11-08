import * as api from "./generated/api.js";
import type {
  GetUsageParams,
  ListWorkflowsParams,
  ObjectTypesRegistry,
  Usage,
  Workflow,
  WorkflowList,
} from "./generated/model.js";
import { paginate } from "./internal.js";
import type { RequestOptions, Transport } from "./transport.js";

/** What an image can be run through: the measurements of the catalog. */
export class Workflows {
  constructor(private readonly transport: Transport) {}

  /** A page of the workflows your key may use: what each takes, the object
   * types its results hold, and the version of its measurement. */
  list(params?: ListWorkflowsParams, options?: RequestOptions): Promise<WorkflowList> {
    return api.listWorkflows(params, this.transport.init(options));
  }

  /** Every workflow your key may use, page after page. */
  iterate(params?: ListWorkflowsParams, options?: RequestOptions): AsyncGenerator<Workflow, void, undefined> {
    return paginate((startingAfter) => this.list({ ...params, startingAfter }, options), params?.startingAfter);
  }
}

/** What a result's objects hold. */
export class ObjectTypes {
  constructor(private readonly transport: Transport) {}

  /** Every object type a result can hold, with its properties, their types
   * and their units, such as a leaf's `area_cm2`. */
  get(options?: RequestOptions): Promise<ObjectTypesRegistry> {
    return api.getObjectTypes(this.transport.init(options));
  }
}

/** The analyses your key has run. */
export class UsageReports {
  constructor(private readonly transport: Transport) {}

  /** The analyses that ended in a range of days, UTC, both included, by
   * day, workflow and outcome; the last 30 days by default. */
  get(params?: GetUsageParams, options?: RequestOptions): Promise<Usage> {
    return api.getUsage(params, this.transport.init(options));
  }
}
