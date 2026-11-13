import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponse, toLoginResponse } from './dto/login-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password and receive a bearer token',
    description:
      'The email is compared ignoring case. The token expires after 8 hours. ' +
      'There is no registration: a SYS_ADMIN creates users.',
  })
  @ApiOkResponse({ type: LoginResponse })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Missing or empty `email` or `password`.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description:
      'Unknown email, wrong password, or a user that is INACTIVE, LOCKED or deleted. ' +
      'The message is always "Invalid email or password."',
  })
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    const { accessToken, user } = await this.authService.login(dto);
    return toLoginResponse(accessToken, user);
  }
}
