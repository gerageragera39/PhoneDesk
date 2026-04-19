import { AppError } from "../../shared/errors/AppError";
import type { Logger } from "../../shared/utils/Logger";
import type { IMouseStrategy } from "./IMouseStrategy";

interface MouseActionResult {
  success: boolean;
  statusCode?: number;
  message?: string;
}

export class MouseService {
  constructor(
    private readonly strategy: IMouseStrategy,
    private readonly logger: Logger,
  ) {}

  public async move(dx: number, dy: number): Promise<MouseActionResult> {
    const safeDx = this.clamp(Math.round(dx), -500, 500);
    const safeDy = this.clamp(Math.round(dy), -500, 500);

    try {
      await this.strategy.move(safeDx, safeDy);
      return { success: true };
    } catch (error) {
      this.logger.error("Mouse move failed", {
        dx: safeDx,
        dy: safeDy,
        error: error instanceof Error ? error.message : "unknown",
      });
      return this.toFailure(error);
    }
  }

  public async click(button: "left" | "right"): Promise<MouseActionResult> {
    try {
      await this.strategy.click(button);
      return { success: true };
    } catch (error) {
      this.logger.error("Mouse click failed", {
        button,
        error: error instanceof Error ? error.message : "unknown",
      });
      return this.toFailure(error);
    }
  }

  public async scroll(dy: number): Promise<MouseActionResult> {
    const safeDy = this.clamp(Math.round(dy), -20, 20);

    try {
      await this.strategy.scroll(safeDy);
      return { success: true };
    } catch (error) {
      this.logger.error("Mouse scroll failed", {
        dy: safeDy,
        error: error instanceof Error ? error.message : "unknown",
      });
      return this.toFailure(error);
    }
  }

  private toFailure(error: unknown): MouseActionResult {
    if (error instanceof AppError) {
      return {
        success: false,
        statusCode: error.statusCode,
        message: error.message,
      };
    }

    return {
      success: false,
      statusCode: 500,
      message: "Mouse action failed",
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
