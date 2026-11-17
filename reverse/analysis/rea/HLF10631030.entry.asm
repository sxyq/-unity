
/Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/HLF10631030.exe.mengoo:	file format coff-x86-64

Disassembly of section .text:

0000000140001000 <.text>:
140001000: 48 ff 25 09 b2 00 00        	jmpq	*0xb209(%rip)           # 0x14000c210
140001007: cc                          	int3
140001008: 40 53                       	pushq	%rbx
14000100a: 48 83 ec 20                 	subq	$0x20, %rsp
14000100e: b9 02 00 00 00              	movl	$0x2, %ecx
140001013: e8 ec 1a 00 00              	callq	0x140002b04 <.text+0x1b04>
140001018: e8 5f 05 00 00              	callq	0x14000157c <.text+0x57c>
14000101d: 8b c8                       	movl	%eax, %ecx
14000101f: e8 08 25 00 00              	callq	0x14000352c <.text+0x252c>
140001024: e8 47 05 00 00              	callq	0x140001570 <.text+0x570>
140001029: 8b d8                       	movl	%eax, %ebx
14000102b: e8 88 26 00 00              	callq	0x1400036b8 <.text+0x26b8>
140001030: b9 01 00 00 00              	movl	$0x1, %ecx
140001035: 89 18                       	movl	%ebx, (%rax)
140001037: e8 c0 02 00 00              	callq	0x1400012fc <.text+0x2fc>
14000103c: 84 c0                       	testb	%al, %al
14000103e: 74 73                       	je	0x1400010b3 <.text+0xb3>
140001040: e8 f7 07 00 00              	callq	0x14000183c <.text+0x83c>
140001045: 48 8d 0d 2c 08 00 00        	leaq	0x82c(%rip), %rcx       # 0x140001878 <.text+0x878>
14000104c: e8 5b 04 00 00              	callq	0x1400014ac <.text+0x4ac>
140001051: e8 1e 05 00 00              	callq	0x140001574 <.text+0x574>
140001056: 8b c8                       	movl	%eax, %ecx
140001058: e8 33 1d 00 00              	callq	0x140002d90 <.text+0x1d90>
14000105d: 85 c0                       	testl	%eax, %eax
14000105f: 75 52                       	jne	0x1400010b3 <.text+0xb3>
140001061: e8 1e 05 00 00              	callq	0x140001584 <.text+0x584>
140001066: e8 5d 05 00 00              	callq	0x1400015c8 <.text+0x5c8>
14000106b: 85 c0                       	testl	%eax, %eax
14000106d: 74 0c                       	je	0x14000107b <.text+0x7b>
14000106f: 48 8d 0d fa 04 00 00        	leaq	0x4fa(%rip), %rcx       # 0x140001570 <.text+0x570>
140001076: e8 e9 1a 00 00              	callq	0x140002b64 <.text+0x1b64>
14000107b: e8 18 05 00 00              	callq	0x140001598 <.text+0x598>
140001080: e8 13 05 00 00              	callq	0x140001598 <.text+0x598>
140001085: e8 e6 04 00 00              	callq	0x140001570 <.text+0x570>
14000108a: 8b c8                       	movl	%eax, %ecx
14000108c: e8 87 25 00 00              	callq	0x140003618 <.text+0x2618>
140001091: e8 fe 04 00 00              	callq	0x140001594 <.text+0x594>
140001096: 84 c0                       	testb	%al, %al
140001098: 74 05                       	je	0x14000109f <.text+0x9f>
14000109a: e8 a5 20 00 00              	callq	0x140003144 <.text+0x2144>
14000109f: e8 cc 04 00 00              	callq	0x140001570 <.text+0x570>
1400010a4: e8 cb 06 00 00              	callq	0x140001774 <.text+0x774>
1400010a9: 85 c0                       	testl	%eax, %eax
1400010ab: 75 06                       	jne	0x1400010b3 <.text+0xb3>
1400010ad: 48 83 c4 20                 	addq	$0x20, %rsp
1400010b1: 5b                          	popq	%rbx
1400010b2: c3                          	retq
1400010b3: b9 07 00 00 00              	movl	$0x7, %ecx
1400010b8: e8 2f 05 00 00              	callq	0x1400015ec <.text+0x5ec>
1400010bd: cc                          	int3
1400010be: cc                          	int3
1400010bf: cc                          	int3
1400010c0: 48 83 ec 28                 	subq	$0x28, %rsp
1400010c4: e8 e3 04 00 00              	callq	0x1400015ac <.text+0x5ac>
1400010c9: 33 c0                       	xorl	%eax, %eax
1400010cb: 48 83 c4 28                 	addq	$0x28, %rsp
1400010cf: c3                          	retq
1400010d0: 48 83 ec 28                 	subq	$0x28, %rsp
1400010d4: e8 f7 06 00 00              	callq	0x1400017d0 <.text+0x7d0>
1400010d9: e8 92 04 00 00              	callq	0x140001570 <.text+0x570>
1400010de: 8b c8                       	movl	%eax, %ecx
1400010e0: 48 83 c4 28                 	addq	$0x28, %rsp
1400010e4: e9 a3 25 00 00              	jmp	0x14000368c <.text+0x268c>
1400010e9: cc                          	int3
1400010ea: cc                          	int3
1400010eb: cc                          	int3
1400010ec: 48 89 5c 24 08              	movq	%rbx, 0x8(%rsp)
1400010f1: 57                          	pushq	%rdi
1400010f2: 48 83 ec 30                 	subq	$0x30, %rsp
1400010f6: b9 01 00 00 00              	movl	$0x1, %ecx
1400010fb: e8 b0 01 00 00              	callq	0x1400012b0 <.text+0x2b0>
140001100: 84 c0                       	testb	%al, %al
140001102: 0f 84 30 01 00 00           	je	0x140001238 <.text+0x238>
140001108: 40 32 ff                    	xorb	%dil, %dil
14000110b: 40 88 7c 24 20              	movb	%dil, 0x20(%rsp)
140001110: e8 5f 01 00 00              	callq	0x140001274 <.text+0x274>
140001115: 8a d8                       	movb	%al, %bl
140001117: 8b 0d fb 48 01 00           	movl	0x148fb(%rip), %ecx     # 0x140015a18 <AmdPowerXpressRequestHighPerformance+0xa14>
14000111d: 83 f9 01                    	cmpl	$0x1, %ecx
140001120: 0f 84 1d 01 00 00           	je	0x140001243 <.text+0x243>
140001126: 85 c9                       	testl	%ecx, %ecx
140001128: 75 4a                       	jne	0x140001174 <.text+0x174>
14000112a: c7 05 e4 48 01 00 01 00 00 00       	movl	$0x1, 0x148e4(%rip) # 0x140015a18 <AmdPowerXpressRequestHighPerformance+0xa14>
140001134: 48 8d 15 55 b1 00 00        	leaq	0xb155(%rip), %rdx      # 0x14000c290
14000113b: 48 8d 0d 1e b1 00 00        	leaq	0xb11e(%rip), %rcx      # 0x14000c260
140001142: e8 bd 20 00 00              	callq	0x140003204 <.text+0x2204>
140001147: 85 c0                       	testl	%eax, %eax
140001149: 74 0a                       	je	0x140001155 <.text+0x155>
14000114b: b8 ff 00 00 00              	movl	$0xff, %eax
140001150: e9 d8 00 00 00              	jmp	0x14000122d <.text+0x22d>
140001155: 48 8d 15 fc b0 00 00        	leaq	0xb0fc(%rip), %rdx      # 0x14000c258
14000115c: 48 8d 0d e5 b0 00 00        	leaq	0xb0e5(%rip), %rcx      # 0x14000c248
140001163: e8 38 20 00 00              	callq	0x1400031a0 <.text+0x21a0>
140001168: c7 05 a6 48 01 00 02 00 00 00       	movl	$0x2, 0x148a6(%rip) # 0x140015a18 <AmdPowerXpressRequestHighPerformance+0xa14>
140001172: eb 08                       	jmp	0x14000117c <.text+0x17c>
140001174: 40 b7 01                    	movb	$0x1, %dil
140001177: 40 88 7c 24 20              	movb	%dil, 0x20(%rsp)
14000117c: 8a cb                       	movb	%bl, %cl
14000117e: e8 9d 02 00 00              	callq	0x140001420 <.text+0x420>
140001183: e8 4c 04 00 00              	callq	0x1400015d4 <.text+0x5d4>
140001188: 48 8b d8                    	movq	%rax, %rbx
14000118b: 48 83 38 00                 	cmpq	$0x0, (%rax)
14000118f: 74 1e                       	je	0x1400011af <.text+0x1af>
140001191: 48 8b c8                    	movq	%rax, %rcx
140001194: e8 ef 01 00 00              	callq	0x140001388 <.text+0x388>
140001199: 84 c0                       	testb	%al, %al
14000119b: 74 12                       	je	0x1400011af <.text+0x1af>
14000119d: 45 33 c0                    	xorl	%r8d, %r8d
1400011a0: 41 8d 50 02                 	leal	0x2(%r8), %edx
1400011a4: 33 c9                       	xorl	%ecx, %ecx
1400011a6: 48 8b 03                    	movq	(%rbx), %rax
1400011a9: ff 15 81 b0 00 00           	callq	*0xb081(%rip)           # 0x14000c230
1400011af: e8 28 04 00 00              	callq	0x1400015dc <.text+0x5dc>
1400011b4: 48 8b d8                    	movq	%rax, %rbx
1400011b7: 48 83 38 00                 	cmpq	$0x0, (%rax)
1400011bb: 74 14                       	je	0x1400011d1 <.text+0x1d1>
1400011bd: 48 8b c8                    	movq	%rax, %rcx
1400011c0: e8 c3 01 00 00              	callq	0x140001388 <.text+0x388>
1400011c5: 84 c0                       	testb	%al, %al
1400011c7: 74 08                       	je	0x1400011d1 <.text+0x1d1>
1400011c9: 48 8b 0b                    	movq	(%rbx), %rcx
1400011cc: e8 13 23 00 00              	callq	0x1400034e4 <.text+0x24e4>
1400011d1: e8 62 05 00 00              	callq	0x140001738 <.text+0x738>
1400011d6: 0f b7 d8                    	movzwl	%ax, %ebx
1400011d9: e8 6e 1f 00 00              	callq	0x14000314c <.text+0x214c>
1400011de: 44 8b cb                    	movl	%ebx, %r9d
1400011e1: 4c 8b c0                    	movq	%rax, %r8
1400011e4: 33 d2                       	xorl	%edx, %edx
1400011e6: 48 8d 0d 13 ee ff ff        	leaq	-0x11ed(%rip), %rcx     # 0x140000000
1400011ed: e8 0e fe ff ff              	callq	0x140001000 <.text>
1400011f2: 8b d8                       	movl	%eax, %ebx
1400011f4: e8 83 05 00 00              	callq	0x14000177c <.text+0x77c>
1400011f9: 84 c0                       	testb	%al, %al
1400011fb: 74 50                       	je	0x14000124d <.text+0x24d>
1400011fd: 40 84 ff                    	testb	%dil, %dil
140001200: 75 05                       	jne	0x140001207 <.text+0x207>
140001202: e8 c1 22 00 00              	callq	0x1400034c8 <.text+0x24c8>
140001207: 33 d2                       	xorl	%edx, %edx
140001209: b1 01                       	movb	$0x1, %cl
14000120b: e8 34 02 00 00              	callq	0x140001444 <.text+0x444>
140001210: 8b c3                       	movl	%ebx, %eax
140001212: eb 19                       	jmp	0x14000122d <.text+0x22d>
140001214: 8b d8                       	movl	%eax, %ebx
140001216: e8 61 05 00 00              	callq	0x14000177c <.text+0x77c>
14000121b: 84 c0                       	testb	%al, %al
14000121d: 74 36                       	je	0x140001255 <.text+0x255>
14000121f: 80 7c 24 20 00              	cmpb	$0x0, 0x20(%rsp)
140001224: 75 05                       	jne	0x14000122b <.text+0x22b>
140001226: e8 8d 22 00 00              	callq	0x1400034b8 <.text+0x24b8>
14000122b: 8b c3                       	movl	%ebx, %eax
14000122d: 48 8b 5c 24 40              	movq	0x40(%rsp), %rbx
140001232: 48 83 c4 30                 	addq	$0x30, %rsp
140001236: 5f                          	popq	%rdi
140001237: c3                          	retq
140001238: b9 07 00 00 00              	movl	$0x7, %ecx
14000123d: e8 aa 03 00 00              	callq	0x1400015ec <.text+0x5ec>
140001242: 90                          	nop
140001243: b9 07 00 00 00              	movl	$0x7, %ecx
140001248: e8 9f 03 00 00              	callq	0x1400015ec <.text+0x5ec>
14000124d: 8b cb                       	movl	%ebx, %ecx
14000124f: e8 cc 22 00 00              	callq	0x140003520 <.text+0x2520>
140001254: 90                          	nop
140001255: 8b cb                       	movl	%ebx, %ecx
140001257: e8 7c 22 00 00              	callq	0x1400034d8 <.text+0x24d8>
14000125c: 90                          	nop
14000125d: cc                          	int3
14000125e: cc                          	int3
14000125f: cc                          	int3
140001260: 48 83 ec 28                 	subq	$0x28, %rsp
140001264: e8 5b 02 00 00              	callq	0x1400014c4 <.text+0x4c4>
140001269: 48 83 c4 28                 	addq	$0x28, %rsp
14000126d: e9 7a fe ff ff              	jmp	0x1400010ec <.text+0xec>
140001272: cc                          	int3
140001273: cc                          	int3
140001274: 48 83 ec 28                 	subq	$0x28, %rsp
140001278: e8 db 07 00 00              	callq	0x140001a58 <.text+0xa58>
14000127d: 85 c0                       	testl	%eax, %eax
14000127f: 74 21                       	je	0x1400012a2 <.text+0x2a2>
140001281: 65 48 8b 04 25 30 00 00 00  	movq	%gs:0x30, %rax
14000128a: 48 8b 48 08                 	movq	0x8(%rax), %rcx
14000128e: eb 05                       	jmp	0x140001295 <.text+0x295>
140001290: 48 3b c8                    	cmpq	%rax, %rcx
140001293: 74 14                       	je	0x1400012a9 <.text+0x2a9>
140001295: 33 c0                       	xorl	%eax, %eax
140001297: f0                          	lock
140001298: 48 0f b1 0d 80 47 01 00     	cmpxchgq	%rcx, 0x14780(%rip)     # 0x140015a20 <AmdPowerXpressRequestHighPerformance+0xa1c>
1400012a0: 75 ee                       	jne	0x140001290 <.text+0x290>
1400012a2: 32 c0                       	xorb	%al, %al
1400012a4: 48 83 c4 28                 	addq	$0x28, %rsp
1400012a8: c3                          	retq
1400012a9: b0 01                       	movb	$0x1, %al
1400012ab: eb f7                       	jmp	0x1400012a4 <.text+0x2a4>
1400012ad: cc                          	int3
1400012ae: cc                          	int3
1400012af: cc                          	int3
1400012b0: 40 53                       	pushq	%rbx
1400012b2: 48 83 ec 20                 	subq	$0x20, %rsp
1400012b6: 0f b6 05 6b 47 01 00        	movzbl	0x1476b(%rip), %eax     # 0x140015a28 <AmdPowerXpressRequestHighPerformance+0xa24>
1400012bd: 85 c9                       	testl	%ecx, %ecx
1400012bf: bb 01 00 00 00              	movl	$0x1, %ebx
1400012c4: 0f 44 c3                    	cmovel	%ebx, %eax
1400012c7: 88 05 5b 47 01 00           	movb	%al, 0x1475b(%rip)      # 0x140015a28 <AmdPowerXpressRequestHighPerformance+0xa24>
1400012cd: e8 e2 05 00 00              	callq	0x1400018b4 <.text+0x8b4>
1400012d2: e8 ad 09 00 00              	callq	0x140001c84 <.text+0xc84>
1400012d7: 84 c0                       	testb	%al, %al
1400012d9: 75 04                       	jne	0x1400012df <.text+0x2df>
1400012db: 32 c0                       	xorb	%al, %al
1400012dd: eb 14                       	jmp	0x1400012f3 <.text+0x2f3>
1400012df: e8 04 29 00 00              	callq	0x140003be8 <.text+0x2be8>
1400012e4: 84 c0                       	testb	%al, %al
1400012e6: 75 09                       	jne	0x1400012f1 <.text+0x2f1>
1400012e8: 33 c9                       	xorl	%ecx, %ecx
1400012ea: e8 bd 09 00 00              	callq	0x140001cac <.text+0xcac>
1400012ef: eb ea                       	jmp	0x1400012db <.text+0x2db>
1400012f1: 8a c3                       	movb	%bl, %al
1400012f3: 48 83 c4 20                 	addq	$0x20, %rsp
1400012f7: 5b                          	popq	%rbx
1400012f8: c3                          	retq
1400012f9: cc                          	int3
1400012fa: cc                          	int3
1400012fb: cc                          	int3
1400012fc: 40 53                       	pushq	%rbx
1400012fe: 48 83 ec 20                 	subq	$0x20, %rsp
140001302: 80 3d 20 47 01 00 00        	cmpb	$0x0, 0x14720(%rip)     # 0x140015a29 <AmdPowerXpressRequestHighPerformance+0xa25>
140001309: 8b d9                       	movl	%ecx, %ebx
14000130b: 75 67                       	jne	0x140001374 <.text+0x374>
14000130d: 83 f9 01                    	cmpl	$0x1, %ecx
140001310: 77 6a                       	ja	0x14000137c <.text+0x37c>
140001312: e8 41 07 00 00              	callq	0x140001a58 <.text+0xa58>
140001317: 85 c0                       	testl	%eax, %eax
140001319: 74 28                       	je	0x140001343 <.text+0x343>
14000131b: 85 db                       	testl	%ebx, %ebx
14000131d: 75 24                       	jne	0x140001343 <.text+0x343>
14000131f: 48 8d 0d 0a 47 01 00        	leaq	0x1470a(%rip), %rcx     # 0x140015a30 <AmdPowerXpressRequestHighPerformance+0xa2c>
140001326: e8 21 27 00 00              	callq	0x140003a4c <.text+0x2a4c>
14000132b: 85 c0                       	testl	%eax, %eax
14000132d: 75 10                       	jne	0x14000133f <.text+0x33f>
14000132f: 48 8d 0d 12 47 01 00        	leaq	0x14712(%rip), %rcx     # 0x140015a48 <AmdPowerXpressRequestHighPerformance+0xa44>
