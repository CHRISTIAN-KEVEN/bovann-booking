import { Controller, Get } from '@nestjs/common';
import type { LiveWallResponse } from '@bovann/shared';
import { LivesService } from './lives.service';

/** Public wall of lives: no sign-in, read-only. */
@Controller('lives')
export class LivesController {
  constructor(private readonly lives: LivesService) {}

  /** Everything on the wall now, most recent first, with the categories for the filters. */
  @Get()
  wall(): Promise<LiveWallResponse> {
    return this.lives.wall();
  }
}
