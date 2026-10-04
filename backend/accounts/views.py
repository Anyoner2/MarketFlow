from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import EmailTokenObtainPairSerializer, RegistrationSerializer


class RegistrationView(APIView):
	permission_classes = [AllowAny]

	def post(self, request):
		serializer = RegistrationSerializer(data=request.data)
		serializer.is_valid(raise_exception=True)
		user = serializer.save()
		return Response(serializer.tokens_for_user(user), status=status.HTTP_201_CREATED)


class EmailTokenObtainPairView(TokenObtainPairView):
	permission_classes = [AllowAny]
	serializer_class = EmailTokenObtainPairSerializer
