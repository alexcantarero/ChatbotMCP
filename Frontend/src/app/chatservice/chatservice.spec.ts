import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatService } from './chatservice';

// En este fichero se pueden añadir tests unitarios para ChatService.
describe('ChatService', () => {
  let component: ChatService;
  let fixture: ComponentFixture<ChatService>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatService]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ChatService);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
