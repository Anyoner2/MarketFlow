from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from .models import Store
from .serializers import StoreSerializer


class StoreListCreateView(generics.ListCreateAPIView):
	permission_classes = [IsAuthenticated]
	serializer_class = StoreSerializer

	def get_queryset(self):
		return Store.objects.filter(owner=self.request.user)

	def perform_create(self, serializer):
		serializer.save(owner=self.request.user)


class StoreDetailView(generics.RetrieveUpdateAPIView):
	permission_classes = [IsAuthenticated]
	serializer_class = StoreSerializer

	def get_queryset(self):
		return Store.objects.filter(owner=self.request.user)
