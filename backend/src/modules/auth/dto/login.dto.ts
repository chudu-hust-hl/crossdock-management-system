import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

/** Body of `POST /auth/login`. */
export class LoginDto {
  @ApiProperty({
    example: 'admin@example.com',
    description: 'Compared ignoring case.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}
